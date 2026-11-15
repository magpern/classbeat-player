// Issue #465: the macOS reader says why it has no reading while it waits, ends its osascript child
// when Follow stops, and the follow status shows the reason. A fake execFile and clock: nothing
// here starts a process.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { describeReason, reasonForFailure } from "../../src/core/link/macos-reason.ts";
import { MAC_POLL_MS, MAC_PROMPT_WAIT_MS, MAC_TIMEOUT_MS } from "../../src/core/link/macos-scripts.ts";
import { createController } from "../../src/main/controller.ts";
import { createMacMusic } from "../../src/main/macos-reader.ts";
import type { ExecFileFn, MacMusic } from "../../src/main/macos-reader.ts";
import { converterExamples } from "./fixtures.ts";

const PLAYING = "playing\tspotify:track:X\tSong\tArtist\t10.0\t180000\n";
const REFUSED = Object.assign(new Error("Command failed\nNot authorized to send Apple events to Spotify. (-1743)"), { code: 1 });

interface Child {
  killed: boolean;
  readonly done: (error: Error | null, stdout: string) => void;
}

function rig(): { mac: MacMusic; children: Child[]; live: () => number; tick: () => void; clock: { t: number } } {
  const children: Child[] = [];
  const clock = { t: 0 };
  let running: (() => void)[] = [];
  const exec: ExecFileFn = (_file, _args, _options, done) => {
    const child: Child = { killed: false, done };
    children.push(child);
    return {
      kill() {
        child.killed = true;
      },
    };
  };
  const every = (fn: () => void, ms: number): (() => void) => {
    assert.equal(ms, MAC_POLL_MS);
    running.push(fn);
    return () => {
      running = running.filter((f) => f !== fn);
    };
  };
  const mac = createMacMusic({ exec, now: () => clock.t, every });
  return { mac, children, live: () => children.filter((c) => !c.killed).length, tick: () => running.forEach((f) => f()), clock };
}

test("while the first read waits, the reason is null, then waiting for permission, then not answering", () => {
  const r = rig();
  r.mac.setActive(true);
  assert.equal(r.mac.reason(), null, "the first moments are normal");
  r.clock.t = MAC_TIMEOUT_MS;
  assert.equal(r.mac.reason(), null);
  r.clock.t = MAC_TIMEOUT_MS + 1;
  assert.equal(r.mac.reason(), "waiting-for-permission");
  r.clock.t = MAC_PROMPT_WAIT_MS;
  assert.equal(r.mac.reason(), "waiting-for-permission");
  r.clock.t = MAC_PROMPT_WAIT_MS + 1;
  assert.equal(r.mac.reason(), "not-answering");
  r.children[0].done(null, PLAYING);
  assert.equal(r.mac.reason(), null, "the answer clears it");
});

test("after Spotify has answered, a read in flight past the normal limit is not answering, never waiting for permission", () => {
  const r = rig();
  r.mac.setActive(true);
  r.children[0].done(null, PLAYING);
  r.clock.t = 250;
  r.tick();
  r.clock.t = 250 + MAC_TIMEOUT_MS;
  assert.equal(r.mac.reason(), null);
  r.clock.t += 1;
  assert.equal(r.mac.reason(), "not-answering");
});

test("-1712 (event timed out) is not answering, not a script failure; a syntax error still is one", () => {
  const timedOut = Object.assign(new Error("execution error: Spotify got an error: AppleEvent timed out. (-1712)"), { code: 1 });
  assert.equal(reasonForFailure(timedOut), "not-answering");
  assert.equal(reasonForFailure(Object.assign(new Error("syntax error (-2741)"), { code: 1 })), "script-failed");
});

test("every reason has its own non-empty text, and the waiting one is not the not-answering one", () => {
  const all = ["not-running", "not-permitted", "waiting-for-permission", "not-answering", "script-failed"] as const;
  const texts = all.map(describeReason);
  assert.equal(new Set(texts).size, all.length);
  for (const t of texts) assert.ok(t.length > 10);
});

test("Follow off ends the osascript child, and on again starts one child, never two", () => {
  const r = rig();
  r.mac.setActive(true);
  assert.equal(r.live(), 1);
  r.mac.setActive(false);
  assert.equal(r.children[0].killed, true);
  assert.equal(r.live(), 0);
  r.mac.setActive(true);
  assert.equal(r.children.length, 2);
  assert.equal(r.live(), 1, "one child during the prompt");
  // The killed child's late callback must not set a reason or a reading.
  r.children[0].done(Object.assign(new Error("killed"), { killed: true }), "");
  assert.equal(r.mac.reason(), null);
});

test("a read that has answered leaves nothing to kill", () => {
  const r = rig();
  r.mac.setActive(true);
  r.children[0].done(null, PLAYING);
  r.mac.setActive(false);
  assert.equal(r.children[0].killed, false);
});

test("a runner that returns nothing, or whose kill throws, does not break stopping", () => {
  const plain = createMacMusic({ exec: () => undefined, now: () => 0, every: () => () => undefined });
  plain.setActive(true);
  plain.setActive(false);
  const angry = createMacMusic({
    exec: () => ({
      kill() {
        throw new Error("gone");
      },
    }),
    now: () => 0,
    every: () => () => undefined,
  });
  angry.setActive(true);
  assert.doesNotThrow(() => angry.setActive(false));
});

test("after -1743 the next read uses the first-read limit, not the short one", () => {
  const limits: number[] = [];
  const done: ((e: Error | null, out: string) => void)[] = [];
  const clock = { t: 0 };
  let poll = (): void => undefined;
  const mac = createMacMusic({
    exec: (_f, _a, options, cb) => {
      limits.push(options.timeout);
      done.push(cb);
    },
    now: () => clock.t,
    every: (fn) => {
      poll = fn;
      return () => undefined;
    },
  });
  mac.setActive(true);
  done[0](null, PLAYING);
  clock.t = 250;
  poll();
  done[1](REFUSED, "");
  clock.t = 500;
  poll();
  assert.equal(limits[1], MAC_TIMEOUT_MS, "after an answer the short limit");
  assert.equal(limits[2], limits[0], "after a refusal the long first-read limit again");
  assert.ok(limits[2] > MAC_TIMEOUT_MS);
});

const text = readFileSync(converterExamples()[0], "utf8");

test("the controller passes the reason into the link view while following, and clears it with the reading", () => {
  const r = rig();
  const c = createController(() => r.clock.t, r.mac, r.mac);
  c.open("a.json", text);
  c.command({ type: "follow" });
  assert.equal(c.snapshot().link?.noReading, null, "nothing yet");
  r.clock.t = MAC_TIMEOUT_MS + 1;
  assert.equal(c.snapshot().link?.noReading, "waiting-for-permission");
  r.children[0].done(REFUSED, "");
  assert.equal(c.snapshot().link?.noReading, "not-permitted");
  c.command({ type: "manual" });
  assert.equal(c.snapshot().link?.noReading, null, "back on the manual clock there is nothing to explain");
});

test("the app quitting (controller.stop) ends the osascript child", () => {
  const r = rig();
  const c = createController(() => r.clock.t, r.mac, r.mac);
  c.open("a.json", text);
  c.command({ type: "follow" });
  assert.equal(r.live(), 1);
  c.stop();
  assert.equal(r.live(), 0);
});
