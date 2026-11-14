// The macOS reader at its edge, with a fake execFile: nothing here starts a process. It covers
// the exact scripts (a fixed allowlist, no shell, nothing interpolated), a timeout, an error,
// Spotify not running, garbage output, a call that never answers, and when it runs at all.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isCurrent } from "../../src/core/link/index.ts";
import { describeReason, reasonForFailure } from "../../src/core/link/macos-reason.ts";
import { MAC_FIRST_READ_MS, MAC_POLL_MS, MAC_SCRIPTS, MAC_TIMEOUT_MS, OSASCRIPT, osascriptArgs } from "../../src/core/link/macos-scripts.ts";
import { createMacMusic, EXEC_OPTIONS, FIRST_GIVE_UP_MS, FIRST_READ_OPTIONS, GIVE_UP_MS } from "../../src/main/macos-reader.ts";
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
      "set playerStateText to player state as string",
      'if playerStateText is "stopped" then return "stopped"',
      "set currentTrackRef to current track",
      "return playerStateText & tab & (id of currentTrackRef) & tab & (name of currentTrackRef) & tab & (artist of currentTrackRef) & tab & (player position as string) & tab & (duration of currentTrackRef as string)",
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
  assert.deepEqual(EXEC_OPTIONS, { timeout: MAC_TIMEOUT_MS, maxBuffer: 8192, killSignal: "SIGKILL", windowsHide: true, shell: false, encoding: "utf8" });
  // Until Spotify has answered once, the read may wait for the Automation prompt; the child is killed at that limit.
  assert.deepEqual(call.options, { ...EXEC_OPTIONS, timeout: MAC_FIRST_READ_MS });
  assert.equal(call.options, FIRST_READ_OPTIONS);
  assert.ok(Object.isFrozen(EXEC_OPTIONS) && Object.isFrozen(FIRST_READ_OPTIONS));
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
    // Stopped is also what Spotify says between two songs: held for one poll (issue #51, item 4).
    if (out === "stopped\n") {
      assert.equal(r.mac.latest(250)?.seenAt, 0, "the reading it had, as it was");
      r.clock.t = 500;
      r.tick();
      r.calls[2].done(null, out);
    }
    assert.equal(r.mac.latest(r.clock.t), null);
    r.clock.t += 250;
    r.tick();
    assert.deepEqual(r.calls.at(-1)?.args, READ_ARGS, "it keeps asking with the same read script only");
    assert.equal(r.calls.length, out === "stopped\n" ? 4 : 3);
  }
});

test("a call that never answers is given up, and a late answer to it is dropped", () => {
  const r = rig();
  r.mac.setActive(true);
  r.calls[0].done(null, PLAYING);
  r.clock.t = 250;
  r.tick();
  r.clock.t = 250 + GIVE_UP_MS - 1;
  r.tick();
  assert.equal(r.calls.length, 2);
  r.clock.t = 250 + GIVE_UP_MS;
  r.tick();
  assert.equal(r.calls.length, 3);
  r.calls[1].done(null, "playing\tid\tOld\tArtist\t1.0\t1000\n");
  assert.notEqual(r.mac.latest(r.clock.t)?.title, "Old", "the old call's answer is not a reading");
  r.calls[2].done(null, PLAYING);
  r.calls[2].done(null, "notrunning\n");
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
    // The second one was queued, not dropped (test/unit/macos-queue.test.ts): it goes now.
    assert.equal(r.calls.length, n + 2);
    assert.deepEqual(r.calls[n + 1].args, MAC_SCRIPTS.next.flatMap((l) => ["-e", l]));
    r.calls[n + 1].done(null, "notrunning\n");
  }
  assert.equal(r.mac.latest(0), before);
});

// Issue #458: the variable names, the wait for the Automation prompt and the reasons.

// AppleScript's own terms and short names: any of them as a variable can stop the script
// compiling on a real Mac (spike 1: "Expected expression but found st", -2741).
const RESERVED = new Set(["it", "me", "my", "id", "name", "text", "date", "result", "item", "first", "last", "count", "version", "class", "index", "number", "string", "list", "record"]);
const variableNames = (lines: readonly string[]): string[] => lines.flatMap((l) => [...l.matchAll(/\b(?:set|copy)\s+([A-Za-z_]\w*)\s+to\b/g)].map((m) => m[1]));
const badVariableName = (n: string): boolean => n.length < 6 || RESERVED.has(n.toLowerCase());

test("no AppleScript variable has a short or reserved name, and the check catches the old script", () => {
  const names = Object.values(MAC_SCRIPTS).flatMap((lines) => variableNames(lines));
  assert.deepEqual(names, ["playerStateText", "currentTrackRef"]);
  assert.deepEqual(names.filter(badVariableName), []);
  const old = ["set st to player state as string", "set tr to current track"];
  assert.deepEqual(variableNames(old).filter(badVariableName), ["st", "tr"], "restoring st fails the test");
  for (const n of ["st", "tr", "it", "me", "id", "name"]) assert.equal(badVariableName(n), true, n);
});

test("the first read waits for the Automation prompt: an answer after 5 s is accepted", () => {
  const r = rig();
  r.mac.setActive(true);
  for (let t = 250; t <= 5000; t += 250) {
    r.clock.t = t;
    r.tick();
  }
  assert.equal(r.calls.length, 1, "no second read joins the one that waits for the prompt");
  r.calls[0].done(null, PLAYING);
  assert.equal(r.mac.latest(5000)?.title, "Song");
  assert.equal(r.mac.reason(), null);
  // The answer was Spotify's own: from now on the normal limit holds.
  r.clock.t = 5250;
  r.tick();
  assert.equal(r.calls[1].options, EXEC_OPTIONS);
});

test("a first read that comes back not running does not end the wait", () => {
  const r = rig();
  r.mac.setActive(true);
  r.calls[0].done(null, "notrunning\n");
  r.clock.t = 250;
  r.tick();
  assert.equal(r.calls[1].options, FIRST_READ_OPTIONS, "Spotify has not been asked yet, so no prompt has been answered");
});

test("after one answer a read past 700 ms is not answering, even if the runner ignored the limit", () => {
  const r = rig();
  r.mac.setActive(true);
  r.calls[0].done(null, PLAYING);
  r.clock.t = 250;
  r.tick();
  r.clock.t = 250 + MAC_TIMEOUT_MS + 1;
  r.calls[1].done(null, PLAYING.replace("Song", "Late"));
  assert.equal(r.mac.latest(r.clock.t)?.title, "Song", "the late answer is not a reading");
  assert.equal(r.mac.reason(), "not-answering");
  r.tick();
  r.clock.t += 100;
  r.calls[2].done(null, PLAYING.replace("Song", "Next"));
  assert.equal(r.mac.latest(r.clock.t)?.title, "Next");
  assert.equal(r.mac.reason(), null);
});

test("a runner that never settles does not block the poll loop, before or after the first answer", () => {
  const r = rig();
  r.mac.setActive(true);
  r.clock.t = FIRST_GIVE_UP_MS - 1;
  r.tick();
  assert.equal(r.calls.length, 1);
  r.clock.t = FIRST_GIVE_UP_MS;
  r.tick();
  assert.equal(r.calls.length, 2, "the first read is given up after its long limit and asked again");
  r.calls[1].done(null, PLAYING);
  r.clock.t += 250;
  r.tick();
  r.clock.t += GIVE_UP_MS;
  r.tick();
  assert.equal(r.calls.length, 4, "after an answer the normal limit holds");
});

const osascriptError = (text: string): Error => Object.assign(new Error(`Command failed: osascript\n${text}`), { code: 1 });

const REASONS: readonly [string, Error, string][] = [
  ["Automation refused (-1743)", osascriptError("execution error: Not authorized to send Apple events to Spotify. (-1743)"), "not-permitted"],
  ["Spotify not running (-600)", osascriptError("execution error: Spotify got an error: Application isn’t running. (-600)"), "not-running"],
  ["a syntax error (-2741)", osascriptError('96:98: syntax error: Expected expression but found "st". (-2741)'), "script-failed"],
  ["a call killed at its limit", Object.assign(new Error("killed"), { killed: true, signal: "SIGKILL" }), "not-answering"],
  ["osascript missing", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "script-failed"],
];

for (const [label, error, reason] of REASONS) {
  test(`${label} gives the reason "${reason}", and the next good read clears it`, () => {
    const r = rig();
    r.mac.setActive(true);
    assert.equal(r.mac.reason(), null);
    r.calls[0].done(error, "");
    assert.equal(r.mac.reason(), reason);
    assert.equal(r.mac.latest(0), null);
    r.clock.t = 250;
    r.tick();
    r.calls.at(-1)?.done(null, PLAYING);
    assert.equal(r.mac.reason(), null);
  });
}

test("-1743, -600 and a syntax error are three distinct reasons, each with its own text", () => {
  const got = REASONS.slice(0, 3).map(([, e]) => reasonForFailure(e));
  assert.equal(new Set(got).size, 3);
  assert.match(describeReason("not-permitted"), /System Settings, Privacy & Security, Automation/);
  const texts = (["not-running", "not-permitted", "not-answering", "script-failed"] as const).map(describeReason);
  assert.equal(new Set(texts).size, 4);
});

test("Spotify's own not-running answer, and an unreadable one, are reasons; stopping forgets them", () => {
  const r = rig();
  r.mac.setActive(true);
  r.calls[0].done(null, "notrunning\n");
  assert.equal(r.mac.reason(), "not-running");
  r.clock.t = 250;
  r.tick();
  r.calls[1].done(null, "something else\n");
  assert.equal(r.mac.reason(), "script-failed");
  r.mac.setActive(false);
  assert.equal(r.mac.reason(), null);
});

test("only the newest read says why: a given-up call that answers late does not", () => {
  const r = rig();
  r.mac.setActive(true);
  r.clock.t = FIRST_GIVE_UP_MS;
  r.tick();
  r.calls[0].done(osascriptError("x (-1743)"), "");
  assert.equal(r.mac.reason(), null);
});
