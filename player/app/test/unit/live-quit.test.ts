// The quit waits, for a bounded time, while the phone remote may leave a session on the backend
// (#205; src/main/live/quit.ts): a start answer still to come, or an ender still trying. Against the
// fake live process (test/unit/live-relay.ts) and its fake clock. Fakes only: no network.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { END_TRY_MS } from "../../src/main/live/ender.ts";
import { QUIT_WAIT_MS, quitAfterLive } from "../../src/main/live/quit.ts";
import { HOST_TOKEN, rig, started } from "./live-relay.ts";
import type { Rig } from "./live-relay.ts";

const SRC = join(import.meta.dirname, "..", "..", "src");
const sources = (dir = SRC): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : [relative(SRC, p)];
  });

const HELLO = { v: 1, type: "hello", token: HOST_TOKEN };
const END = { v: 1, type: "end" };

interface Quit {
  /** Emits will-quit once; true when the listener held the quit. */
  willQuit(): boolean;
  exits: number;
  relaunches: number;
  launchedAgain(): boolean;
}

function quit(r: Rig | null): Quit {
  const q = {
    exits: 0,
    relaunches: 0,
    willQuit: () => {
      let held = false;
      handler.willQuit({ preventDefault: () => void (held = true) });
      return held;
    },
    launchedAgain: () => handler.launchedAgain(),
  };
  const handler = quitAfterLive({
    live: () => r?.live ?? null,
    exit: () => void (q.exits += 1),
    relaunch: () => void (q.relaunches += 1),
    setTimer: (fn, ms) => r?.setTimer(fn, ms) ?? null,
    clearTimer: (h) => r?.clearTimer(h),
  });
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

test("nothing to end: the quit is not held", () => {
  // Off, and no live service at all.
  const off = rig();
  const qOff = quit(off);
  assert.equal(qOff.willQuit(), false);
  const none = quit(null);
  assert.equal(none.willQuit(), false);
  assert.equal(qOff.exits + none.exits, 0);
});

// #211: the most common quit. The session is live and `end` goes out on the host's own connection.
test("live: the quit waits until the live process answers the host's own end, then exits", async () => {
  const r = await started();
  const host = r.socket();
  const q = quit(r);
  assert.equal(q.willQuit(), true);
  assert.deepEqual(host.sent.filter((m) => (m as { type?: string }).type === "end"), [END]);
  // The connection is kept for the answer; no other connection is opened.
  assert.equal(host.closedByApp, false);
  assert.equal(r.sockets.length, 1);
  await r.advance(100);
  assert.equal(q.exits, 0);
  host.server({ v: 1, type: "ended", reason: "host_ended" });
  assert.equal(host.closedByApp, true);
  await r.advance(0);
  assert.equal(q.exits, 1);
  assert.equal(r.sockets.length, 1);
});

test("live: the server closing the host's connection with 4403 after end lets the quit go on", async () => {
  const r = await started();
  const q = quit(r);
  assert.equal(q.willQuit(), true);
  r.socket().drop(4403);
  await r.advance(0);
  assert.equal(q.exits, 1);
  assert.equal(r.sockets.length, 1);
});

test("live: end lost with a 1006 drop goes to the ender, and the quit waits for it within the bound", async () => {
  const r = await started();
  const q = quit(r);
  assert.equal(q.willQuit(), true);
  r.socket().drop(1006);
  await r.advance(0);
  // The ender's own connection: hello with the host token, then end.
  assert.equal(r.sockets.length, 2);
  assert.equal(q.exits, 0);
  r.socket().open();
  assert.deepEqual(r.socket().sent, [HELLO]);
  await r.advance(QUIT_WAIT_MS);
  assert.equal(q.exits, 1);
});

test("live: no answer to the host's end, the app still exits after QUIT_WAIT_MS", async () => {
  const r = await started();
  const q = quit(r);
  assert.equal(q.willQuit(), true);
  await r.advance(QUIT_WAIT_MS - 1);
  assert.equal(q.exits, 0);
  await r.advance(1);
  assert.equal(q.exits, 1);
});

// #216 (#204 review): the bounds in milliseconds, not through the constants they are named by.
test("live with no answer: the app exits at 5 s, and the host's connection would wait 10 s", async () => {
  assert.equal(QUIT_WAIT_MS, 5_000);
  assert.equal(END_TRY_MS, 10_000);
  const r = await started();
  const host = r.socket();
  const q = quit(r);
  assert.equal(q.willQuit(), true);
  await r.advance(4_999);
  assert.equal(q.exits, 0);
  await r.advance(1);
  assert.equal(q.exits, 1);
  await r.advance(4_999);
  assert.equal(host.closedByApp, false);
  await r.advance(1);
  assert.equal(host.closedByApp, true);
});

test("a launch during the wait starts the app again after the exit; one without a wait is the window's", async () => {
  const r = rig();
  r.live.start();
  const q = quit(r);
  // Before any quit, a second launch is not the quit's: the window comes to the front.
  assert.equal(q.launchedAgain(), false);
  assert.equal(q.willQuit(), true);
  assert.equal(q.launchedAgain(), true);
  assert.equal(q.launchedAgain(), true);
  assert.equal(q.relaunches, 0);
  await r.advance(QUIT_WAIT_MS);
  assert.deepEqual([q.exits, q.relaunches], [1, 1]);
  assert.equal(q.launchedAgain(), false);
  // A quit that waits for nothing starts nothing again.
  const off = quit(rig());
  assert.equal(off.willQuit(), false);
  assert.equal(off.launchedAgain(), false);
  assert.equal(off.relaunches, 0);
});

const MAIN = readFileSync(join(import.meta.dirname, "..", "..", "src", "main", "main.ts"), "utf8");

test("the shell's will-quit ends the phone remote through the bounded wait, and exits without a second will-quit", () => {
  const main = MAIN;
  assert.match(main, /const quit = quitAfterLive\(\{\s+live: \(\) => phoneRemote,\s+exit: \(\) => app\.exit\(0\),\s+relaunch: \(\) => app\.relaunch\(\),/);
  assert.match(main, /app\.on\("will-quit", quit\.willQuit\);/);
  // A second launch asks the quit first.
  assert.match(main, /app\.on\("second-instance", \(\) => \{\s+(?:\/\/.*\s+)*if \(quit\.launchedAgain\(\)\) return;/);
  // The presenter closing stops it too; the quit after it still waits for what that left running.
  assert.doesNotMatch(main, /"will-quit", \(\) => phoneRemote/);
});

test("quitAfterLive stays the last will-quit listener, so the rest has stopped before it waits", () => {
  const code = MAIN.replace(/\/\/.*$/gm, "");
  const listeners = [...code.matchAll(/\b(?:app\.)?(?:on|once|addListener|prependListener|prependOnceListener)\(\s*["']will-quit["']\s*,\s*([^\n]*)/g)].map((m) => m[1]);
  assert.ok(listeners.length >= 5, String(listeners.length));
  assert.equal(listeners.filter((l) => l.startsWith("quit.willQuit")).length, 1);
  assert.match(listeners[listeners.length - 1], /^quit\.willQuit\)/);
  // No will-quit listener is added anywhere else in the app's source.
  const others = sources().filter((p) => p !== join("main", "main.ts") && /["']will-quit["']/.test(readFileSync(join(SRC, p), "utf8").replace(/\/\/.*$/gm, "")));
  assert.deepEqual(others, []);
});
