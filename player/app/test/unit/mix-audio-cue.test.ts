// What passes between the shell and the room's <audio> (core/mix/audio-cue.ts): strict parsing both ways, and the steering.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DRIFT_MS, LENGTH_TOLERANCE_MS, mixCueOf, mixPositionOf, parseAudioReport, parseMixCue, steer, wrongLength } from "../../src/core/mix/audio-cue.ts";

const URL = `cbp-mix://play/${"0".repeat(32)}`;
const report = { seq: 3, positionMs: 1500.4, playing: true, failed: false, durationMs: 60_000.6 };
const cue = { seq: 2, url: URL, playing: true, positionMs: 1000 };

test("a report is five fields of their types and ranges, and nothing else", () => {
  assert.deepEqual(parseAudioReport(report), { seq: 3, positionMs: 1500, playing: true, failed: false, durationMs: 60_001 });
  assert.deepEqual(parseAudioReport({ ...report, durationMs: null }), { seq: 3, positionMs: 1500, playing: true, failed: false, durationMs: null });
  for (const bad of [
    null,
    "x",
    [],
    Object.create({ seq: 1 }),
    { ...report, extra: 1 },
    { seq: 3, positionMs: 1, playing: true },
    { ...report, seq: 0 },
    { ...report, seq: 1.5 },
    { ...report, seq: "3" },
    { ...report, positionMs: -1 },
    { ...report, positionMs: Number.NaN },
    { ...report, positionMs: Infinity },
    { ...report, positionMs: 100_000_001 },
    { ...report, playing: 1 },
    { ...report, failed: "no" },
    { seq: 3, positionMs: 1, playing: true, failed: false },
    { ...report, durationMs: Number.NaN },
    { ...report, durationMs: Infinity },
    { ...report, durationMs: -1 },
    { ...report, durationMs: "60000" },
    { ...report, durationMs: 100_000_001 },
  ]) {
    assert.equal(parseAudioReport(bad), null, JSON.stringify(bad));
  }
});

test("a cue is four fields, its URL none or a play URL", () => {
  assert.deepEqual(parseMixCue(cue), cue);
  assert.deepEqual(parseMixCue({ ...cue, url: null, seq: 0 }), { ...cue, url: null, seq: 0 });
  for (const bad of [
    null,
    { ...cue, extra: 1 },
    { ...cue, url: "https://example.invalid/a.mp3" },
    { ...cue, url: `${URL}?x` },
    { ...cue, url: "file:///etc/passwd" },
    { ...cue, url: 5 },
    { ...cue, seq: -1 },
    { ...cue, seq: 1.5 },
    { ...cue, playing: "yes" },
    { ...cue, positionMs: -1 },
    { ...cue, positionMs: Number.NaN },
  ]) {
    assert.equal(parseMixCue(bad), null, JSON.stringify(bad));
  }
});

test("mixCueOf copies the four fields and nothing more", () => {
  const sent = mixCueOf({ ...cue, secret: "x" } as typeof cue);
  assert.deepEqual(Object.keys(sent).sort(), ["playing", "positionMs", "seq", "url"]);
  assert.deepEqual(sent, cue);
});

test("steer: the clock follows the audio past the drift, within the class", () => {
  assert.ok(DRIFT_MS < 50, "inside ADR 0001's 50 ms beat target");
  assert.equal(DRIFT_MS, 30);
  assert.equal(steer(10_000, 10_030, 0, 60_000), null);
  assert.equal(steer(10_000, 10_031, 0, 60_000), 10_031);
  assert.equal(steer(10_000, 9_970, 0, 60_000), null);
  assert.equal(steer(10_000, 9_969, 0, 60_000), 9_969);
  assert.equal(steer(10_000, 9_000, 0, 60_000), 9_000);
  assert.equal(steer(10_000, 15_000, 5_000, 60_000), null, "offset");
  assert.equal(steer(1_000, 500, 5_000, 60_000), 0, "never below 0");
  assert.equal(steer(1_000, 90_000, 0, 60_000), 60_000, "never past the class");
  assert.equal(mixPositionOf(1_000, 5_000), 6_000);
});

test("wrongLength: a decoded length more than 1 000 ms from length_ms, and only a known one", () => {
  assert.equal(LENGTH_TOLERANCE_MS, 1000);
  assert.equal(wrongLength(null, 60_000), false, "not decoded yet");
  assert.equal(wrongLength(61_000, 60_000), false);
  assert.equal(wrongLength(59_000, 60_000), false);
  assert.equal(wrongLength(61_001, 60_000), true);
  assert.equal(wrongLength(58_999, 60_000), true);
  assert.equal(wrongLength(0, 60_000), true);
});
