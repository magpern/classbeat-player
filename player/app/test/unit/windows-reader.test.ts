// The Windows reader against a fake helper process: it runs only while following; a hang, a
// crash, garbage, no Spotify session and another app's session all end as null or an ageing
// reading (rule 8), and the helper is replaced after a growing wait. Nothing here starts a process.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LINK_CONFIG, isCurrent } from "../../src/core/link/index.ts";
import { backoffMs } from "../../src/main/readers/helper-supervisor.ts";
import { createWindowsMusic, MIN_COMMAND_GAP_MS, WINDOWS_HELPER_LIMITS as LIMITS } from "../../src/main/readers/windows-reader.ts";
import type { WindowsMusic } from "../../src/main/readers/windows-reader.ts";
import { MAX_LINE_LENGTH } from "../../src/main/readers/windows-parse.ts";
import { createHarness, NO_SESSION, sessionLine } from "./windows-harness.ts";
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

test("another app's session is ignored: it never becomes a reading", () => {
  const { h, r } = following();
  const chrome = sessionLine({ app: "Chrome", title: "Somebody else's video" });
  h.child.line(chrome);
  assert.equal(r.latest(h.now), null);
  h.child.line(sessionLine());
  h.child.line(chrome);
  assert.equal(r.latest(h.now), null, "not even the Spotify reading before it is passed off as current");
  assert.equal(h.children.length, 1, "the helper is well; it is not replaced");
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

test("play, pause and next are written to the helper as their fixed names, and nothing else is", () => {
  const { h, r } = following();
  r.send("play");
  h.advance(MIN_COMMAND_GAP_MS);
  r.send("pause");
  h.advance(MIN_COMMAND_GAP_MS);
  r.send("next");
  assert.deepEqual(h.child.written, ["play\n", "pause\n", "next\n"]);
  h.advance(MIN_COMMAND_GAP_MS);
  for (const bad of ["previous", "next\nplay", "play; calc.exe", "", "PLAY", " play", 7, null, { toString: () => "play" }]) {
    h.advance(MIN_COMMAND_GAP_MS);
    r.send(bad as never);
  }
  assert.deepEqual(h.child.written.length, 3, "only the three names ever reach the helper");
});

test("commands are dropped when they come too fast, and when no helper runs", () => {
  const { h, r } = following();
  for (let i = 0; i < 100; i++) r.send("next");
  assert.deepEqual(h.child.written, ["next\n"]);
  h.advance(MIN_COMMAND_GAP_MS - 1);
  r.send("next");
  assert.equal(h.child.written.length, 1);
  h.advance(1);
  r.send("pause");
  assert.deepEqual(h.child.written, ["next\n", "pause\n"]);

  h.child.die();
  h.advance(MIN_COMMAND_GAP_MS);
  r.send("play");
  r.setActive(false);
  r.send("play");
  assert.equal(h.children.length, 1, "a command never starts a helper");
  assert.equal(h.child.written.length, 2);
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
