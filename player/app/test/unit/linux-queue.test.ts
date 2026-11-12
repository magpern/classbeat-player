// The Linux transport: a command sent while another is in flight waits (at most one, the newest),
// and is neither dropped silently nor sent twice. A fake execFile: nothing here starts a process.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINUX_POLL_MS } from "../../src/core/link/linux-calls.ts";
import { createLinuxMusic, GIVE_UP_MS } from "../../src/main/linux-reader.ts";
import type { ExecFileFn } from "../../src/main/linux-reader.ts";
import { REPO } from "./fixtures.ts";

const PLAYING = readFileSync(join(REPO, "player", "app", "test", "fixtures", "linux", "playing.json"), "utf8");

function rig() {
  const calls: { method: string; done: (e: Error | null, out: string) => void }[] = [];
  const clock = { t: 0 };
  // The last argument is the D-Bus method: Play, Pause or Next (the read call ends otherwise).
  const exec: ExecFileFn = (_file, args, _options, done) => void calls.push({ method: args.at(-1) ?? "", done });
  const linux = createLinuxMusic({ exec, now: () => clock.t, every: (fn, ms) => (assert.equal(ms, LINUX_POLL_MS), () => void fn) });
  linux.setActive(true);
  calls[0].done(null, PLAYING); // the first poll: Spotify is there
  calls.length = 0;
  const commands = (): string[] => calls.map((c) => c.method).filter((m) => ["Play", "Pause", "Next"].includes(m));
  return { linux, calls, clock, commands };
}

test("a second command while one is in flight waits and goes when the first is done: a double Next is two nexts", () => {
  const { linux, commands, calls } = rig();
  linux.send("next");
  linux.send("next");
  assert.deepEqual(commands(), ["Next"], "one at a time");
  calls[0].done(null, "");
  assert.deepEqual(commands(), ["Next", "Next"]);
  calls[1].done(null, "");
  assert.equal(calls.length, 2, "and nothing is sent a third time");
});

test("only one waits: a newer command replaces the older one waiting", () => {
  const { linux, commands, calls } = rig();
  linux.send("pause");
  linux.send("next");
  linux.send("play");
  calls[0].done(null, "");
  assert.deepEqual(commands(), ["Pause", "Play"]);
  calls[1].done(null, "");
  assert.equal(calls.length, 2);
});

test("a failed command still lets the waiting one go", () => {
  const { linux, commands, calls } = rig();
  linux.send("pause");
  linux.send("next");
  calls[0].done(new Error("failed"), "");
  assert.deepEqual(commands(), ["Pause", "Next"]);
});

test("a command that never answers is given up, and a new one then goes at once", () => {
  const { linux, commands, clock } = rig();
  linux.send("pause");
  linux.send("next");
  assert.deepEqual(commands(), ["Pause"]);
  clock.t = GIVE_UP_MS + 1;
  linux.send("play");
  assert.deepEqual(commands(), ["Pause", "Play"], "the stale waiting command is replaced, not sent besides");
});

test("stopping the follower clears what waits, and a late answer sends nothing", () => {
  const { linux, commands, calls } = rig();
  linux.send("pause");
  linux.send("next");
  linux.setActive(false);
  calls[0].done(null, "");
  assert.deepEqual(commands(), ["Pause"]);
  linux.send("play");
  assert.equal(calls.length, 1, "not following: nothing is sent");
});
