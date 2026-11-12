// The Linux reader at its edge, with a fake execFile: nothing here starts a process or talks to
// a D-Bus. It covers the exact calls (a fixed allowlist, no shell, nothing interpolated, one bus
// name, no service start), a timeout, an error, Spotify not running, garbage output, a call that
// never answers, and when it runs at all. Other players, the age of a reading and the gate on
// commands are in test/unit/linux-others.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isCurrent } from "../../src/core/link/index.ts";
import { BUSCTL, LINUX_CALLS, LINUX_MAX_OUTPUT_BYTES, LINUX_POLL_MS, LINUX_TIMEOUT_MS, MPRIS_NAME } from "../../src/core/link/linux-calls.ts";
import { createLinuxMusic, EXEC_OPTIONS, GIVE_UP_MS } from "../../src/main/linux-reader.ts";
import type { ExecFileFn, ExecOptions, LinuxMusic } from "../../src/main/linux-reader.ts";
import { REPO } from "./fixtures.ts";

const fx = (name: string): string => readFileSync(join(REPO, "player", "app", "test", "fixtures", "linux", name), "utf8");
const PLAYING = fx("playing.json");
const STOPPED = fx("stopped.json");
const FLAGS = ["--user", "--no-pager", "--auto-start=no", "--timeout=500ms", "--json=short", "call"];
const HEAD = [...FLAGS, "org.mpris.MediaPlayer2.spotify", "/org/mpris/MediaPlayer2"];
/** The bus's answer when no other player is there. */
const NO_OTHERS = '{"type":"as","data":[["org.freedesktop.DBus",":1.7","org.mpris.MediaPlayer2.spotify"]]}\n';
const READ_ARGS = [...HEAD, "org.freedesktop.DBus.Properties", "GetAll", "s", "org.mpris.MediaPlayer2.Player"];
const NOT_RUNNING = Object.assign(new Error('Command failed: Call failed: Name "org.mpris.MediaPlayer2.spotify" does not exist'), { code: 1 });

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: ExecOptions;
  readonly done: (error: Error | null, stdout: string) => void;
}

/** `calls` holds the calls to Spotify; the bus is asked for its names `listed.n` times and has no other player. */
function rig(): { linux: LinuxMusic; calls: Call[]; listed: { n: number }; tick: () => void; timers: () => number; clock: { t: number } } {
  const calls: Call[] = [];
  const listed = { n: 0 };
  const clock = { t: 0 };
  let running: (() => void)[] = [];
  const exec: ExecFileFn = (file, args, options, done) => {
    assert.equal(file, BUSCTL);
    assert.equal(options, EXEC_OPTIONS);
    if (args !== LINUX_CALLS.names) return void calls.push({ file, args, options, done });
    listed.n += 1;
    done(null, NO_OTHERS);
  };
  const every = (fn: () => void, ms: number): (() => void) => {
    assert.equal(ms, LINUX_POLL_MS);
    running.push(fn);
    return () => {
      running = running.filter((f) => f !== fn);
    };
  };
  const linux = createLinuxMusic({ exec, now: () => clock.t, every });
  return { linux, calls, listed, tick: () => running.forEach((f) => f()), timers: () => running.length, clock };
}

test("the calls are exactly these: Spotify's own name on the session bus, and never a service start", () => {
  assert.deepEqual(LINUX_CALLS, {
    read: READ_ARGS,
    play: [...HEAD, "org.mpris.MediaPlayer2.Player", "Play"],
    pause: [...HEAD, "org.mpris.MediaPlayer2.Player", "Pause"],
    next: [...HEAD, "org.mpris.MediaPlayer2.Player", "Next"],
    names: [...FLAGS, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "ListNames"],
  });
  assert.equal(MPRIS_NAME, "org.mpris.MediaPlayer2.spotify");
  for (const [name, args] of Object.entries(LINUX_CALLS)) {
    assert.ok(args.includes("--auto-start=no"), `${name} never starts a service`);
    assert.ok(args.includes("--user") && !args.includes("--system"), `${name} uses the session bus`);
    // Every call goes to Spotify's name, but the one that asks the bus itself for its names.
    assert.equal(args[args.indexOf("call") + 1], name === "names" ? "org.freedesktop.DBus" : "org.mpris.MediaPlayer2.spotify", name);
    assert.equal(args.filter((a) => a.startsWith("org.mpris.MediaPlayer2.") && a !== "org.mpris.MediaPlayer2.Player").length, name === "names" ? 0 : 1, name);
    assert.doesNotMatch(args.join(" "), /\b(Raise|Quit|OpenUri|Seek|SetPosition|Set|Previous|Stop|Volume|StartServiceByName|monitor|capture|emit|set-property|http|token)\b|--host|--machine|--address|[*?$`;|&<>]/i, name);
  }
  assert.equal(BUSCTL, "/usr/bin/busctl");
});

test("the allowlist is frozen: five calls, and the only commands are play, pause and next", () => {
  assert.ok(Object.isFrozen(LINUX_CALLS));
  for (const args of Object.values(LINUX_CALLS)) assert.ok(Object.isFrozen(args));
  assert.deepEqual(Object.keys(LINUX_CALLS), ["read", "play", "pause", "next", "names"]);
});

test("nothing runs until following is turned on, and nothing after it is turned off", () => {
  const r = rig();
  assert.equal(r.linux.kind, "linux");
  assert.equal(r.linux.latest(0), null);
  r.tick();
  r.linux.send("play");
  assert.equal(r.calls.length + r.listed.n, 0);
  assert.equal(r.timers(), 0);

  r.linux.setActive(true);
  r.linux.setActive(true);
  assert.equal(r.timers(), 1, "one timer, however often it is turned on");
  assert.equal(r.calls.length, 1, "the first reading is asked for at once");

  r.calls[0].done(null, PLAYING);
  r.linux.setActive(false);
  assert.equal(r.timers(), 0);
  r.tick();
  r.linux.send("next");
  r.tick();
  assert.equal(r.calls.length, 1);
  assert.equal(r.listed.n, 0, "and while Spotify plays the bus is asked nothing else");
});

test("a timer that fires once more after following stopped runs nothing", () => {
  const calls: unknown[] = [];
  let late: () => void = () => assert.fail("no timer was started");
  const linux = createLinuxMusic({ exec: (...call) => void calls.push(call), now: () => 0, every: (fn) => ((late = fn), () => undefined) });
  linux.setActive(true);
  linux.setActive(false);
  assert.equal(calls.length, 1);
  late();
  assert.equal(calls.length, 1);
});

test("a reading: busctl by absolute path, the fixed read call, no shell, a timeout and a size limit", () => {
  const r = rig();
  r.clock.t = 1000;
  r.linux.setActive(true);
  const call = r.calls[0];
  assert.equal(call.file, "/usr/bin/busctl");
  assert.deepEqual(call.args, READ_ARGS);
  assert.deepEqual(call.options, { timeout: LINUX_TIMEOUT_MS, maxBuffer: 65_536, killSignal: "SIGKILL", windowsHide: true, shell: false, encoding: "utf8" });
  assert.equal(call.options, EXEC_OPTIONS);
  assert.ok(Object.isFrozen(EXEC_OPTIONS));
  assert.ok(LINUX_TIMEOUT_MS <= 1000 && LINUX_POLL_MS === 250 && LINUX_MAX_OUTPUT_BYTES === 65_536);

  r.clock.t = 1080;
  call.done(null, PLAYING);
  // Rule 8: the position was read inside the call (its midpoint); the reader got it at the end.
  assert.deepEqual(r.linux.latest(1080), {
    title: "Spike Song A",
    artist: "Spike Artist",
    lengthMs: 180_000,
    trackId: "/com/spotify/track/SPIKEEXAMPLE0001",
    app: "Spotify",
    positionMs: 12_500,
    playing: true,
    at: 1040,
    seenAt: 1080,
  });
});

test("what the music app reports never changes what is run", () => {
  const r = rig();
  r.linux.setActive(true);
  const hostile = PLAYING.replace("Spike Song A", "--system $(x) `x`; x").replace("/com/spotify/track/SPIKEEXAMPLE0001", "org.mpris.MediaPlayer2.other /x Raise");
  assert.notEqual(hostile, PLAYING);
  r.calls[0].done(null, hostile);
  assert.equal(r.linux.latest(0)?.title, "--system $(x) `x`; x");
  r.tick();
  r.linux.send("pause");
  assert.deepEqual(r.calls[1].args, READ_ARGS);
  assert.equal(r.calls[2].args, LINUX_CALLS.pause);
  for (const c of r.calls) assert.equal(c.file, BUSCTL);
});

test("one call at a time: a slow call is not joined by another", () => {
  const r = rig();
  r.linux.setActive(true);
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
  ["Spotify not running (busctl exits 1)", (c) => c.done(NOT_RUNNING, "")],
  ["no session bus", (c) => c.done(Object.assign(new Error("Failed to set bus address"), { code: 1 }), "")],
  ["busctl missing", (c) => c.done(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "")],
  ["too much output", (c) => c.done(Object.assign(new Error("maxBuffer"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }), PLAYING)],
  ["an error together with a good answer", (c) => c.done(new Error("exit 1"), PLAYING.replace("Spike Song A", "Other"))],
  ["garbage output", (c) => c.done(null, "Call failed: Connection timed out\n")],
  ["JSON of another shape", (c) => c.done(null, '{"type":"b","data":[true]}\n')],
  ["empty output", (c) => c.done(null, "")],
  ["output that is not text", (c) => c.done(null, Buffer.from(PLAYING) as unknown as string)],
];

for (const [label, fail] of failures) {
  test(`${label}: the last reading is kept and ages (rule 8), nothing throws, the next poll goes on`, () => {
    const r = rig();
    r.linux.setActive(true);
    r.clock.t = 40;
    r.calls[0].done(null, PLAYING);
    const good = r.linux.latest(40);
    assert.equal(good?.seenAt, 40);
    assert.ok(good);

    r.clock.t = 250;
    r.tick();
    r.clock.t = 950;
    fail(r.calls[1]);
    assert.equal(r.linux.latest(950), good, "the same old reading");
    assert.equal(isCurrent(good, 2540, 2500), true);
    assert.equal(isCurrent(good, 2541, 2500), false, "and it goes stale by its own time");

    r.clock.t = 1000;
    r.tick();
    assert.equal(r.calls.length, 3);
    assert.deepEqual(r.calls[2].args, READ_ARGS, "it keeps asking with the same read call only");
  });

  test(`${label}, before anything was read: no reading`, () => {
    const r = rig();
    r.linux.setActive(true);
    fail(r.calls[0]);
    assert.equal(r.linux.latest(0), null);
  });
}

test("Spotify with nothing loaded: no reading, and nothing is done about it", () => {
  const r = rig();
  r.linux.setActive(true);
  r.calls[0].done(null, PLAYING);
  assert.notEqual(r.linux.latest(0), null);
  r.clock.t = 250;
  r.tick();
  r.calls[1].done(null, STOPPED);
  assert.equal(r.linux.latest(250), null);
  r.clock.t = 500;
  r.tick();
  assert.deepEqual(r.calls[2].args, READ_ARGS, "it keeps asking with the same read call only");
  assert.equal(r.calls.length, 3);
});

test("a call that never answers is given up, and a late answer to it is dropped", () => {
  const r = rig();
  r.linux.setActive(true);
  r.clock.t = GIVE_UP_MS - 1;
  r.tick();
  assert.equal(r.calls.length, 1);
  r.clock.t = GIVE_UP_MS;
  r.tick();
  assert.equal(r.calls.length, 2);
  r.calls[0].done(null, PLAYING);
  assert.equal(r.linux.latest(r.clock.t), null, "the old call's answer is not a reading");
  r.calls[1].done(null, PLAYING);
  r.calls[1].done(null, STOPPED);
  assert.equal(r.linux.latest(r.clock.t)?.title, "Spike Song A", "a call answers once");
});

test("an execFile that throws is a failed call, not a crash", () => {
  const linux = createLinuxMusic({
    exec: () => {
      throw new Error("spawn failed");
    },
    now: () => 0,
    every: () => () => undefined,
  });
  assert.doesNotThrow(() => linux.setActive(true));
  assert.doesNotThrow(() => linux.send("play"));
  assert.equal(linux.latest(0), null);
});

test("an answer that arrives after following stopped is dropped, and the old reading is gone", () => {
  const r = rig();
  r.linux.setActive(true);
  r.calls[0].done(null, PLAYING);
  r.clock.t = 250;
  r.tick();
  r.linux.setActive(false);
  assert.equal(r.linux.latest(250), null);
  r.calls[1].done(null, PLAYING);
  assert.equal(r.linux.latest(250), null);
  r.linux.setActive(true);
  assert.equal(r.linux.latest(250), null, "following again starts from nothing");
});

test("play, pause and next run their fixed calls, one at a time, and their output is ignored", () => {
  const r = rig();
  r.linux.setActive(true);
  r.calls[0].done(null, PLAYING);
  const before = r.linux.latest(0);
  for (const action of ["play", "pause", "next"] as const) {
    const n = r.calls.length;
    r.linux.send(action);
    r.linux.send("next");
    assert.equal(r.calls.length, n + 1, "a second command waits for the first to end");
    const call = r.calls[n];
    assert.equal(call.file, BUSCTL);
    assert.equal(call.args, LINUX_CALLS[action]);
    assert.equal(call.options, EXEC_OPTIONS);
    call.done(action === "pause" ? NOT_RUNNING : null, STOPPED);
    // The second one was queued, not dropped (test/unit/linux-queue.test.ts): it goes now.
    assert.equal(r.calls.length, n + 2);
    assert.equal(r.calls[n + 1].args, LINUX_CALLS.next);
    r.calls[n + 1].done(null, STOPPED);
  }
  assert.equal(r.linux.latest(0), before);
});
