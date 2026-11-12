// The Windows reader against a fake helper process: it runs only while following; a hang, a
// crash, garbage and no Spotify session all end as null or an ageing reading (rule 8), and the
// helper is replaced after a growing wait; another app playing is a reading with that app's id
// only; commands are bounded to one in flight and one waiting. Nothing here starts a process.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LINK_CONFIG, isCurrent } from "../../src/core/link/index.ts";
import { backoffMs } from "../../src/main/readers/helper-supervisor.ts";
import { COMMAND_ANSWER_LINES, createWindowsMusic, WINDOWS_HELPER_LIMITS as LIMITS } from "../../src/main/readers/windows-reader.ts";
import type { WindowsMusic } from "../../src/main/readers/windows-reader.ts";
import { MAX_LINE_LENGTH } from "../../src/core/link/windows-parse.ts";
import { createHarness, NO_SESSION, OTHER_APP, sessionLine } from "./windows-harness.ts";
import type { Harness } from "./windows-harness.ts";

function following(): { h: Harness; r: WindowsMusic } {
  const h = createHarness();
  const r = createWindowsMusic(h.deps);
  r.setActive(true);
  return { h, r };
}

test("the limits are fixed", () => {
  assert.deepEqual(LIMITS, { startTimeoutMs: 15_000, silenceTimeoutMs: 5000, maxGarbageLines: 8, maxLineLength: 8192, healthyMs: 30_000, minGapMs: 1000 });
  assert.equal(MAX_LINE_LENGTH, 8192);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 50].map(backoffMs), [0, 1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
});

test("constructing the reader starts nothing; the helper runs only while following", () => {
  const h = createHarness();
  const r = createWindowsMusic(h.deps);
  assert.equal(r.kind, "windows");
  h.advance(60_000);
  assert.equal(r.latest(h.now), null);
  assert.equal(h.children.length, 0, "no helper before Follow");

  r.setActive(true);
  r.setActive(true);
  assert.equal(h.children.length, 1, "one helper, however often it is asked for");
  h.child.line(sessionLine());
  assert.equal(r.latest(h.now)?.title, "Spike Song A");

  r.setActive(false);
  assert.equal(h.child.killed, true);
  assert.equal(r.latest(h.now), null, "nothing is kept from a stopped helper");
  h.advance(120_000);
  assert.equal(h.children.length, 1, "and it is not restarted");
});

test("a reading carries the time it arrived and the system's own age (rule 8)", () => {
  const { h, r } = following();
  h.advance(400);
  h.child.line(sessionLine());
  assert.deepEqual(r.latest(h.now), { title: "Spike Song A", artist: "Spike Artist", lengthMs: 180_000, trackId: null, app: "Spotify.exe", positionMs: 12_500, playing: true, at: 1400 - 800, seenAt: 1400 });
});

test("lines split across chunks, several in one chunk, and blank lines", () => {
  const { h, r } = following();
  const line = sessionLine({ title: "Split" });
  h.child.emit(line.slice(0, 40));
  assert.equal(r.latest(h.now), null, "half a line is not a reading");
  h.child.emit(`${line.slice(40)}\r\n\r\n${sessionLine({ title: "Second" })}\n${sessionLine({ title: "Third" })}`);
  assert.equal(r.latest(h.now)?.title, "Second", "the last whole line wins; the unfinished one waits");
  h.child.emit("\n");
  assert.equal(r.latest(h.now)?.title, "Third");
});

test("no Spotify session: null, and the helper is left running", () => {
  const { h, r } = following();
  h.child.line(sessionLine());
  h.child.line(NO_SESSION);
  assert.equal(r.latest(h.now), null);
  for (let i = 0; i < 400; i++) {
    h.advance(250);
    h.child.line(NO_SESSION);
  }
  assert.equal(h.children.length, 1);
  assert.equal(h.child.killed, false);
});

test("another app playing is a reading with that app's id and nothing of its own: never Spotify's", () => {
  const { h, r } = following();
  h.child.line(sessionLine());
  h.advance(250);
  h.child.line(OTHER_APP);
  assert.deepEqual(r.latest(h.now), { title: "", artist: "", lengthMs: null, trackId: null, app: "Chrome", positionMs: 0, playing: true, at: h.now, seenAt: h.now });
  assert.equal(h.children.length, 1, "the helper is well; it is not replaced");
  h.advance(250);
  h.child.line(sessionLine({ title: "Back" }));
  assert.equal(r.latest(h.now)?.app, "Spotify.exe");
  assert.equal(r.latest(h.now)?.title, "Back");
});

test("a playing position with no usable age gives no reading, and the helper is left running", () => {
  const { h, r } = following();
  h.child.line(sessionLine());
  for (let i = 0; i < 40; i++) {
    h.advance(250);
    h.child.line(sessionLine({ positionMs: 0, lastUpdatedUtcMs: -11_644_473_600_000 }));
    assert.equal(r.latest(h.now), null);
  }
  assert.equal(h.children.length, 1);
  assert.equal(h.child.killed, false);
});

test("hang after readings: the old reading ages and goes stale, then the helper is replaced", () => {
  const { h, r } = following();
  h.child.line(sessionLine());
  const seen = h.now;
  h.advance(DEFAULT_LINK_CONFIG.staleMs + 1);
  const old = r.latest(h.now);
  assert.equal(old?.seenAt, seen, "the same reading, with the time it was seen");
  assert.equal(old && isCurrent(old, h.now, DEFAULT_LINK_CONFIG.staleMs), false, "stale to the link: never current");

  h.advance(LIMITS.silenceTimeoutMs - DEFAULT_LINK_CONFIG.staleMs - 2);
  assert.equal(h.child.killed, false, "not yet");
  h.advance(1);
  assert.equal(h.children[0].killed, true, "silent for the fixed timeout: dropped");
  assert.equal(r.latest(h.now), null);
  assert.equal(h.children.length, 1);
  h.advance(backoffMs(1));
  assert.equal(h.children.length, 2, "replaced after the first wait");
});

test("hang from the start: dropped after the start timeout", () => {
  const { h, r } = following();
  h.advance(LIMITS.startTimeoutMs - 1);
  assert.equal(h.child.killed, false);
  h.advance(1);
  assert.equal(h.children[0].killed, true);
  assert.equal(r.latest(h.now), null);
});

test("crash: null at once, and restarts wait 1 s, 2 s, 4 s … up to 30 s", () => {
  const { h, r } = following();
  h.child.line(sessionLine());
  const waits: number[] = [];
  for (let i = 0; i < 8; i++) {
    const died = h.now;
    const before = h.children.length;
    h.child.die();
    assert.equal(r.latest(h.now), null);
    assert.equal(h.children.length, before, "never restarted at once");
    while (h.children.length === before) h.advance(100);
    waits.push(Math.round((h.now - died) / 1000) * 1000);
    h.child.line(sessionLine());
    assert.equal(r.latest(h.now)?.title, "Spike Song A", "a replacement's readings are used");
  }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
});

test("a helper that cannot be started is retried with the same growing wait, and nothing throws", () => {
  const h = createHarness();
  h.failSpawn = true;
  const r = createWindowsMusic(h.deps);
  assert.doesNotThrow(() => r.setActive(true));
  h.advance(300_000);
  assert.equal(h.children.length, 0);
  assert.equal(r.latest(h.now), null);
  h.failSpawn = false;
  h.advance(30_000);
  assert.equal(h.children.length, 1, "it starts once it can");
});

test("a helper that has run well for a while starts again from the short wait", () => {
  const { h } = following();
  for (let i = 0; i < 3; i++) {
    h.child.die();
    h.advance(backoffMs(i + 1));
  }
  assert.equal(h.children.length, 4);
  h.child.line(NO_SESSION);
  for (let t = 1000; t < LIMITS.healthyMs; t += 1000) {
    h.advance(1000);
    h.child.line(NO_SESSION);
  }
  h.advance(999);
  h.child.line(NO_SESSION);
  h.child.die();
  h.advance(backoffMs(4) - 1);
  assert.equal(h.children.length, 4, "still counting failures before the healthy time");
  h.advance(1);
  assert.equal(h.children.length, 5);
  for (let t = 0; t < LIMITS.healthyMs; t += 1000) {
    h.advance(1000);
    h.child.line(NO_SESSION);
  }
  h.child.die();
  h.advance(backoffMs(1));
  assert.equal(h.children.length, 6, "healthy for the fixed time: back to the first wait");
});

test("garbage: the last reading is kept and ages; a run of garbage replaces the helper", () => {
  const { h, r } = following();
  h.child.line(sessionLine());
  const seen = h.now;
  for (let i = 0; i < LIMITS.maxGarbageLines - 1; i++) {
    h.advance(250);
    h.child.line("Await : timeout");
  }
  assert.equal(r.latest(h.now)?.seenAt, seen, "garbage never refreshes a reading");
  assert.equal(h.child.killed, false);
  h.child.line(NO_SESSION);
  for (let i = 0; i < LIMITS.maxGarbageLines - 1; i++) h.child.line('{"error":true}');
  assert.equal(h.child.killed, false, "a good line in between starts the count again");
  h.child.line("}{");
  assert.equal(h.children[0].killed, true);
  assert.equal(r.latest(h.now), null);
  h.children[0].line(sessionLine());
  assert.equal(r.latest(h.now), null, "a dropped helper is no longer listened to");
  h.advance(backoffMs(1));
  assert.equal(h.children.length, 2);
});

test("garbage only: silence of good lines still counts as a hang", () => {
  const { h } = following();
  h.child.line(NO_SESSION);
  h.advance(1000);
  h.child.line("x");
  h.advance(LIMITS.silenceTimeoutMs - 1000);
  assert.equal(h.child.killed, true);
});

test("a flood without a line end is cut off and the helper replaced", () => {
  const { h, r } = following();
  h.child.line(sessionLine());
  h.child.emit("x".repeat(MAX_LINE_LENGTH));
  assert.equal(h.child.killed, false);
  h.child.emit("x");
  assert.equal(h.child.killed, true);
  assert.equal(r.latest(h.now), null);
});

test("turning following off and on cannot start helpers faster than one a second", () => {
  const { h, r } = following();
  for (let i = 0; i < 50; i++) {
    r.setActive(false);
    r.setActive(true);
  }
  assert.equal(h.children.length, 1);
  h.advance(LIMITS.minGapMs);
  assert.equal(h.children.length, 2);
  r.setActive(false);
  r.setActive(true);
  r.setActive(false);
  h.advance(60_000);
  assert.equal(h.children.length, 2, "a pending start is cancelled when following stops");
});

/** The helper answers: enough good lines for a written command to count as done. */
function answer(h: Harness): void {
  for (let i = 0; i < COMMAND_ANSWER_LINES; i++) {
    h.advance(250);
    h.child.line(NO_SESSION);
  }
}

function ready(): { h: Harness; r: WindowsMusic } {
  const f = following();
  f.h.child.line(NO_SESSION);
  return f;
}

test("play, pause and next are written to the helper as their fixed names, and nothing else is", () => {
  const { h, r } = ready();
  for (const action of ["play", "pause", "next"] as const) {
    r.send(action);
    answer(h);
  }
  assert.deepEqual(h.child.written, ["play\n", "pause\n", "next\n"]);
  for (const bad of ["previous", "next\nplay", "play; calc.exe", "", "PLAY", " play", 7, null, { toString: () => "play" }]) {
    r.send(bad as never);
    answer(h);
  }
  assert.equal(h.child.written.length, 3, "only the three names ever reach the helper");
});

test("nothing is written before the helper's first good line; then one command, the newest", () => {
  const { h, r } = following();
  for (let i = 0; i < 10; i++) {
    r.send("next");
    h.advance(1000);
  }
  r.send("pause");
  assert.deepEqual(h.child.written, [], "a helper that has not spoken is not reading its input");
  h.child.line("Await : timeout");
  assert.deepEqual(h.child.written, [], "garbage is not a first good line");
  h.child.line(NO_SESSION);
  assert.deepEqual(h.child.written, ["pause\n"], "one command, not eleven");
  answer(h);
  answer(h);
  assert.equal(h.child.written.length, 1);
});

test("one in flight and one waiting: a double Next is two nexts, and a newer command replaces the waiting one", () => {
  const { h, r } = ready();
  r.send("next");
  r.send("next");
  assert.deepEqual(h.child.written, ["next\n"], "one at a time");
  h.advance(250);
  h.child.line(NO_SESSION);
  assert.equal(h.child.written.length, 1, "the first line after a write may have been on its way already");
  h.advance(250);
  h.child.line(NO_SESSION);
  assert.deepEqual(h.child.written, ["next\n", "next\n"]);
  answer(h);
  answer(h);
  assert.equal(h.child.written.length, 2, "and not three");

  r.send("pause");
  for (let i = 0; i < 100; i++) r.send("next");
  r.send("play");
  answer(h);
  assert.deepEqual(h.child.written.slice(2), ["pause\n", "play\n"]);
  answer(h);
  assert.equal(h.child.written.length, 4);
});

test("during a stall at most one command is in the helper's input and one waits", () => {
  const { h, r } = ready();
  r.send("next");
  for (let i = 0; i < 4; i++) {
    h.advance(1000);
    r.send("next");
  }
  r.send("pause");
  assert.deepEqual(h.child.written, ["next\n"], "a helper that is not answering gets nothing more");
  h.child.line('{"error":true}');
  assert.equal(h.child.written.length, 1, "garbage is no answer");
  answer(h);
  assert.deepEqual(h.child.written, ["next\n", "pause\n"], "it recovers: the one waiting command follows, the newest");
  answer(h);
  assert.equal(h.child.written.length, 2);
});

test("a waiting command is forgotten when following stops or the helper goes; none reaches a later helper", () => {
  const { h, r } = ready();
  r.send("pause");
  r.send("next");
  r.setActive(false);
  r.setActive(true);
  h.advance(5000);
  assert.equal(h.children.length, 2);
  h.child.line(NO_SESSION);
  answer(h);
  assert.deepEqual(h.children.map((c) => c.written), [["pause\n"], []]);

  r.send("pause");
  r.send("next");
  h.child.die();
  h.advance(5000);
  assert.equal(h.children.length, 3);
  h.child.line(NO_SESSION);
  answer(h);
  assert.deepEqual(h.child.written, []);

  const early = following();
  early.r.send("next");
  early.h.advance(LIMITS.startTimeoutMs + 5000);
  assert.equal(early.h.children.length, 2, "the helper that never spoke was replaced");
  early.h.child.line(NO_SESSION);
  assert.deepEqual(early.h.child.written, [], "a command sent to a helper that never came up is not kept for the next one");
});

test("commands do nothing when no helper runs, and never start one", () => {
  const { h, r } = ready();
  h.child.die();
  r.send("play");
  r.setActive(false);
  r.send("play");
  assert.equal(h.children.length, 1, "a command never starts a helper");
  assert.deepEqual(h.child.written, []);
});

test("close stops the helper for good", () => {
  const { h, r } = following();
  h.child.line(sessionLine());
  r.setActive(false);
  assert.equal(h.child.killed, true);
  assert.equal(r.latest(h.now), null);
  h.advance(120_000);
  assert.equal(h.children.length, 1);
  assert.doesNotThrow(() => r.setActive(false));
});
