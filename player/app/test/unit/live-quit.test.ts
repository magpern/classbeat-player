// The quit waits, for a bounded time, while the phone remote may leave a session on the backend
// (#205; src/main/live/quit.ts): a start answer still to come, or an ender still trying. Against the
// fake live process (test/unit/live-relay.ts) and its fake clock. Fakes only: no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { QUIT_WAIT_MS, quitAfterLive } from "../../src/main/live/quit.ts";
import { HOST_TOKEN, rig, started } from "./live-relay.ts";
import type { Rig } from "./live-relay.ts";

const HELLO = { v: 1, type: "hello", token: HOST_TOKEN };
const END = { v: 1, type: "end" };

interface Quit {
  /** Emits will-quit once; true when the listener held the quit. */
  willQuit(): boolean;
  exits: number;
}

function quit(r: Rig | null): Quit {
  const q = {
    exits: 0,
    willQuit: () => {
      let held = false;
      listener({ preventDefault: () => void (held = true) });
      return held;
    },
  };
  const listener = quitAfterLive({ live: () => r?.live ?? null, exit: () => void (q.exits += 1), setTimer: (fn, ms) => r?.setTimer(fn, ms) ?? null, clearTimer: (h) => r?.clearTimer(h) });
  return q;
}

test("the quit waits for the start answer and for its session to be ended, then exits", async () => {
  const r = rig();
  r.live.start();
  const q = quit(r);
  assert.equal(q.willQuit(), true);
  assert.equal(r.live.view().status, "Ended");
  assert.equal(q.exits, 0);
  await r.advance(0);
  // The answer came: its session is ended by the ender, and the quit still waits for it.
  assert.equal(r.sockets.length, 1);
  assert.equal(q.exits, 0);
  const s = r.socket();
  s.open();
  s.server({ v: 1, type: "welcome", role: "host" });
  assert.deepEqual(s.sent, [HELLO, END]);
  s.drop(4403);
  await r.advance(0);
  assert.equal(q.exits, 1);
  await r.advance(QUIT_WAIT_MS);
  assert.equal(q.exits, 1);
});

test("the quit waits for an ender still trying", async () => {
  const r = await started();
  r.socket().drop(1006);
  const q = quit(r);
  assert.equal(q.willQuit(), true);
  assert.equal(r.sockets.length, 2);
  r.socket().drop(1006);
  await r.advance(1000);
  assert.equal(q.exits, 0);
  assert.equal(r.sockets.length, 3);
  r.socket().open();
  r.socket().drop(4401);
  await r.advance(0);
  assert.equal(q.exits, 1);
});

test("the wait is bounded: the app exits after QUIT_WAIT_MS whatever is left", async () => {
  assert.equal(QUIT_WAIT_MS, 5_000);
  const r = rig();
  r.live.start();
  const q = quit(r);
  assert.equal(q.willQuit(), true);
  await r.advance(0);
  r.socket().open();
  await r.advance(QUIT_WAIT_MS - 1);
  assert.equal(q.exits, 0);
  await r.advance(1);
  assert.equal(q.exits, 1);
  await r.advance(60_000);
  assert.equal(q.exits, 1);
});

test("another quit while waiting is held too, and the session is ended once", async () => {
  const r = rig();
  r.live.start();
  const q = quit(r);
  assert.equal(q.willQuit(), true);
  assert.equal(q.willQuit(), true);
  await r.advance(0);
  assert.equal(r.sockets.length, 1);
  r.socket().open();
  r.socket().drop(4401);
  await r.advance(0);
  assert.equal(q.exits, 1);
  assert.equal(q.willQuit(), false);
  assert.equal(q.exits, 1);
});

test("nothing to end: the quit is not held", async () => {
  // Off, live (its `end` goes out on the host's own connection) and no live service at all.
  const off = rig();
  const qOff = quit(off);
  assert.equal(qOff.willQuit(), false);
  const on = await started();
  const qOn = quit(on);
  assert.equal(qOn.willQuit(), false);
  assert.ok(on.socket().sent.some((m) => (m as { type?: string }).type === "end"));
  const none = quit(null);
  assert.equal(none.willQuit(), false);
  assert.equal(qOff.exits + qOn.exits + none.exits, 0);
});

test("the shell's will-quit ends the phone remote through the bounded wait, and exits without a second will-quit", () => {
  const main = readFileSync(join(import.meta.dirname, "..", "..", "src", "main", "main.ts"), "utf8");
  assert.match(main, /app\.on\("will-quit", quitAfterLive\(\{ live: \(\) => phoneRemote, exit: \(\) => app\.exit\(0\)/);
  // The presenter closing stops it too; the quit after it still waits for what that left running.
  assert.doesNotMatch(main, /"will-quit", \(\) => phoneRemote/);
});
