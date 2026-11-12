// The macOS reader at its edge, with a fake execFile: nothing here starts a process. It covers
// the exact scripts (a fixed allowlist, no shell, nothing interpolated), a timeout, an error,
// Spotify not running, garbage output, a call that never answers, and when it runs at all.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isCurrent } from "../../src/core/link/index.ts";
import { MAC_POLL_MS, MAC_SCRIPTS, MAC_TIMEOUT_MS, OSASCRIPT, osascriptArgs } from "../../src/core/link/macos-scripts.ts";
import { createMacMusic, EXEC_OPTIONS, GIVE_UP_MS } from "../../src/main/macos-reader.ts";
import type { ExecFileFn, ExecOptions, MacMusic } from "../../src/main/macos-reader.ts";

const PLAYING = "playing\tspotify:track:X\tSong\tArtist\t10.0\t180000\n";
const READ_ARGS = MAC_SCRIPTS.read.flatMap((l) => ["-e", l]);

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: ExecOptions;
  readonly done: (error: Error | null, stdout: string) => void;
}

function rig(): { mac: MacMusic; calls: Call[]; tick: () => void; timers: () => number; clock: { t: number } } {
  const calls: Call[] = [];
  const clock = { t: 0 };
  let running: (() => void)[] = [];
  const exec: ExecFileFn = (file, args, options, done) => void calls.push({ file, args, options, done });
  const every = (fn: () => void, ms: number): (() => void) => {
    assert.equal(ms, MAC_POLL_MS);
    running.push(fn);
    return () => {
      running = running.filter((f) => f !== fn);
    };
  };
  const mac = createMacMusic({ exec, now: () => clock.t, every });
  return { mac, calls, tick: () => running.forEach((f) => f()), timers: () => running.length, clock };
}

test("the scripts are exactly these, and every one returns before it could start Spotify", () => {
  const guard = 'if application "Spotify" is not running then return "notrunning"';
  assert.deepEqual(MAC_SCRIPTS, {
    read: [
      guard,
      'tell application "Spotify"',
      "set st to player state as string",
      'if st is "stopped" then return "stopped"',
      "set tr to current track",
      "return st & tab & (id of tr) & tab & (name of tr) & tab & (artist of tr) & tab & (player position as string) & tab & (duration of tr as string)",
      "end tell",
    ],
    play: [guard, 'tell application "Spotify" to play'],
    pause: [guard, 'tell application "Spotify" to pause'],
    next: [guard, 'tell application "Spotify" to next track'],
  });
  for (const [name, lines] of Object.entries(MAC_SCRIPTS)) {
    assert.equal(lines[0], guard, name);
    assert.doesNotMatch(lines.join("\n"), /\b(launch|activate|run|open|do shell script|volume|play track|http|token)\b/i, name);
  }
  assert.equal(OSASCRIPT, "/usr/bin/osascript");
});

test("the allowlist is frozen and gives nothing for any other name", () => {
  assert.ok(Object.isFrozen(MAC_SCRIPTS));
  for (const lines of Object.values(MAC_SCRIPTS)) assert.ok(Object.isFrozen(lines));
  for (const name of ["", "previous", "toString", "__proto__", "constructor", 'play" & (do shell script "x") & "', "read\n"]) assert.equal(osascriptArgs(name), null, name);
  assert.deepEqual(osascriptArgs("read"), READ_ARGS);
});

test("nothing runs until following is turned on, and nothing after it is turned off", () => {
  const r = rig();
  assert.equal(r.mac.kind, "macos");
  assert.equal(r.mac.latest(0), null);
  r.tick();
  r.mac.send("play");
  assert.equal(r.calls.length, 0);
  assert.equal(r.timers(), 0);

  r.mac.setActive(true);
  r.mac.setActive(true);
  assert.equal(r.timers(), 1, "one timer, however often it is turned on");
  assert.equal(r.calls.length, 1, "the first reading is asked for at once");

  r.mac.setActive(false);
  assert.equal(r.timers(), 0);
  r.tick();
  r.mac.send("next");
  assert.equal(r.calls.length, 1);
});

test("a reading: osascript by absolute path, the fixed read script, no shell, a timeout and a size limit", () => {
  const r = rig();
  r.clock.t = 1000;
  r.mac.setActive(true);
  const call = r.calls[0];
  assert.equal(call.file, "/usr/bin/osascript");
  assert.deepEqual(call.args, READ_ARGS);
  assert.deepEqual(call.options, { timeout: MAC_TIMEOUT_MS, maxBuffer: 8192, killSignal: "SIGKILL", windowsHide: true, shell: false, encoding: "utf8" });
  assert.equal(call.options, EXEC_OPTIONS);
  assert.ok(Object.isFrozen(EXEC_OPTIONS));
  assert.ok(MAC_TIMEOUT_MS <= 1000 && MAC_POLL_MS === 250);

  r.clock.t = 1080;
  call.done(null, PLAYING);
  // Rule 8: the position was read inside the call (its midpoint); the reader got it at the end.
  assert.deepEqual(r.mac.latest(1080), { title: "Song", artist: "Artist", lengthMs: 180_000, trackId: "spotify:track:X", app: "Spotify", positionMs: 10_000, playing: true, at: 1040, seenAt: 1080 });
});

test("what the music app reports never changes what is run", () => {
  const r = rig();
  r.mac.setActive(true);
  r.calls[0].done(null, 'playing\tid\t" & (do shell script "x") & "\t$(x) `x`; x\t1\t1000\n');
  r.tick();
  r.mac.send("pause");
  assert.deepEqual(r.calls[1].args, READ_ARGS);
  assert.deepEqual(r.calls[2].args, ["-e", MAC_SCRIPTS.pause[0], "-e", MAC_SCRIPTS.pause[1]]);
  for (const c of r.calls) assert.equal(c.file, OSASCRIPT);
});

test("one call at a time: a slow call is not joined by another", () => {
  const r = rig();
  r.mac.setActive(true);
  r.clock.t = 250;
  r.tick();
  r.clock.t = 500;
  r.tick();
  assert.equal(r.calls.length, 1);
  r.calls[0].done(null, PLAYING);
  r.clock.t = 750;
  r.tick();
  assert.equal(r.calls.length, 2);
});

const failures: readonly [string, (c: Call) => void][] = [
  ["a timeout (the system kills the call)", (c) => c.done(Object.assign(new Error("killed"), { killed: true, signal: "SIGKILL" }), "")],
  ["an error from osascript", (c) => c.done(Object.assign(new Error("exit 1"), { code: 1 }), "")],
  ["osascript missing", (c) => c.done(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "")],
  ["too much output", (c) => c.done(Object.assign(new Error("maxBuffer"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }), PLAYING)],
  ["garbage output", (c) => c.done(null, "execution error: Spotify got an error (-609)\n")],
  ["empty output", (c) => c.done(null, "")],
  ["output that is not text", (c) => c.done(null, Buffer.from(PLAYING) as unknown as string)],
];

for (const [label, fail] of failures) {
  test(`${label}: the last reading is kept and ages (rule 8), nothing throws, the next poll goes on`, () => {
    const r = rig();
    r.mac.setActive(true);
    r.clock.t = 40;
    r.calls[0].done(null, PLAYING);
    const good = r.mac.latest(40);
    assert.equal(good?.seenAt, 40);

    r.clock.t = 250;
    r.tick();
    r.clock.t = 950;
    fail(r.calls[1]);
    assert.equal(r.mac.latest(950), good, "the same old reading");
    assert.equal(isCurrent(good, 2540, 2500), true);
    assert.equal(isCurrent(good, 2541, 2500), false, "and it goes stale by its own time");

    r.clock.t = 1000;
    r.tick();
    assert.equal(r.calls.length, 3);
  });

  test(`${label}, before anything was read: no reading`, () => {
    const r = rig();
    r.mac.setActive(true);
    fail(r.calls[0]);
    assert.equal(r.mac.latest(0), null);
  });
}

test("Spotify not running, or with nothing loaded: no reading, and nothing is done about it", () => {
  for (const out of ["notrunning\n", "stopped\n"]) {
    const r = rig();
    r.mac.setActive(true);
    r.calls[0].done(null, PLAYING);
    assert.notEqual(r.mac.latest(0), null);
    r.clock.t = 250;
    r.tick();
    r.calls[1].done(null, out);
    assert.equal(r.mac.latest(250), null);
    r.clock.t = 500;
    r.tick();
    assert.deepEqual(r.calls[2].args, READ_ARGS, "it keeps asking with the same read script only");
    assert.equal(r.calls.length, 3);
  }
});

test("a call that never answers is given up, and a late answer to it is dropped", () => {
  const r = rig();
  r.mac.setActive(true);
  r.clock.t = GIVE_UP_MS - 1;
  r.tick();
  assert.equal(r.calls.length, 1);
  r.clock.t = GIVE_UP_MS;
  r.tick();
  assert.equal(r.calls.length, 2);
  r.calls[0].done(null, PLAYING);
  assert.equal(r.mac.latest(r.clock.t), null, "the old call's answer is not a reading");
  r.calls[1].done(null, PLAYING);
  r.calls[1].done(null, "notrunning\n");
  assert.equal(r.mac.latest(r.clock.t)?.title, "Song", "a call answers once");
});

test("an execFile that throws is a failed call, not a crash", () => {
  const mac = createMacMusic({
    exec: () => {
      throw new Error("spawn failed");
    },
    now: () => 0,
    every: () => () => undefined,
  });
  assert.doesNotThrow(() => mac.setActive(true));
  assert.doesNotThrow(() => mac.send("play"));
  assert.equal(mac.latest(0), null);
});

test("an answer that arrives after following stopped is dropped, and the old reading is gone", () => {
  const r = rig();
  r.mac.setActive(true);
  r.calls[0].done(null, PLAYING);
  r.clock.t = 250;
  r.tick();
  r.mac.setActive(false);
  assert.equal(r.mac.latest(250), null);
  r.calls[1].done(null, PLAYING);
  assert.equal(r.mac.latest(250), null);
  r.mac.setActive(true);
  assert.equal(r.mac.latest(250), null, "following again starts from nothing");
});

test("play, pause and next run their fixed scripts, one at a time, and their output is ignored", () => {
  const r = rig();
  r.mac.setActive(true);
  r.calls[0].done(null, PLAYING);
  const before = r.mac.latest(0);
  for (const action of ["play", "pause", "next"] as const) {
    const n = r.calls.length;
    r.mac.send(action);
    r.mac.send("next");
    assert.equal(r.calls.length, n + 1, "a second command waits for the first to end");
    const call = r.calls[n];
    assert.equal(call.file, OSASCRIPT);
    assert.deepEqual(call.args, MAC_SCRIPTS[action].flatMap((l) => ["-e", l]));
    assert.equal(call.options, EXEC_OPTIONS);
    call.done(action === "pause" ? new Error("failed") : null, "notrunning\n");
  }
  assert.equal(r.mac.latest(0), before);
});
