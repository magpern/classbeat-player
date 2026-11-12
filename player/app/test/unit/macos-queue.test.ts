// The macOS transport: a command sent while another is in flight waits (at most one, the newest),
// and is neither dropped silently nor sent twice. A fake execFile: nothing here starts a process.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAC_POLL_MS, MAC_SCRIPTS } from "../../src/core/link/macos-scripts.ts";
import { createMacMusic, GIVE_UP_MS } from "../../src/main/macos-reader.ts";
import type { ExecFileFn } from "../../src/main/macos-reader.ts";

const line = (action: "play" | "pause" | "next"): string => MAC_SCRIPTS[action].join("\n");

function rig() {
  const calls: { script: string; done: (e: Error | null, out: string) => void }[] = [];
  const clock = { t: 0 };
  const exec: ExecFileFn = (_file, args, _options, done) => void calls.push({ script: args.filter((_, i) => i % 2 === 1).join("\n"), done });
  const mac = createMacMusic({ exec, now: () => clock.t, every: (fn, ms) => (assert.equal(ms, MAC_POLL_MS), () => void fn) });
  mac.setActive(true);
  calls[0].done(null, "notrunning\n"); // the first poll
  calls.length = 0;
  const commands = (): string[] => calls.map((c) => c.script).filter((s) => !s.includes("player state"));
  return { mac, calls, clock, commands };
}

test("a second command while one is in flight waits and goes when the first is done: a double Next is two nexts", () => {
  const { mac, commands, calls } = rig();
  mac.send("next");
  mac.send("next");
  assert.deepEqual(commands(), [line("next")], "one at a time");
  calls[0].done(null, "");
  assert.deepEqual(commands(), [line("next"), line("next")]);
  calls[1].done(null, "");
  assert.equal(commands().length, 2, "and nothing is sent a third time");
});

test("only one waits: a newer command replaces the older one waiting", () => {
  const { mac, commands, calls } = rig();
  mac.send("pause");
  mac.send("next");
  mac.send("play");
  calls[0].done(null, "");
  assert.deepEqual(commands(), [line("pause"), line("play")]);
  calls[1].done(null, "");
  assert.equal(commands().length, 2);
});

test("a failed command still lets the waiting one go", () => {
  const { mac, commands, calls } = rig();
  mac.send("pause");
  mac.send("next");
  calls[0].done(new Error("failed"), "");
  assert.deepEqual(commands(), [line("pause"), line("next")]);
});

test("a command that never answers is given up, and a new one then goes at once", () => {
  const { mac, commands, clock } = rig();
  mac.send("pause");
  mac.send("next");
  assert.deepEqual(commands(), [line("pause")]);
  clock.t = GIVE_UP_MS + 1;
  mac.send("play");
  assert.deepEqual(commands(), [line("pause"), line("play")], "the stale waiting command is replaced, not sent besides");
});

test("stopping the follower clears what waits, and a late answer sends nothing", () => {
  const { mac, commands, calls } = rig();
  mac.send("pause");
  mac.send("next");
  mac.setActive(false);
  calls[0].done(null, "");
  assert.deepEqual(commands(), [line("pause")]);
  mac.send("play");
  assert.deepEqual(commands(), [line("pause")], "not following: nothing is sent");
});
