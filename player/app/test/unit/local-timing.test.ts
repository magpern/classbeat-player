// When each song of a local class plays and who owns an overlap (ADR 0017 section 3; ADR 0001 rules
// 1 to 3), and the equal-power gains of a crossfade. Pure: no files, no clock.
import assert from "node:assert/strict";
import { test } from "node:test";
import { gainAt } from "../../src/core/music-files/local-cue.ts";
import { activeAt, classTimeOf, fadeOf, localTimingOf, ownerAt, slotsAt } from "../../src/core/music-files/local-timing.ts";

const XF = 6_000;
// Three songs of a 290 s class: each designed to end where the next starts, each file longer than that.
const SONGS = [
  { startMs: 0, endMs: 100_000, lengthMs: 110_000 },
  { startMs: 100_000, endMs: 200_000, lengthMs: 210_000 },
  { startMs: 200_000, endMs: 300_000, lengthMs: 500_000 },
];
const T = localTimingOf(SONGS, XF, 290_000);

test("each song starts at start_ms and stops at min(its end, end_ms + design_crossfade_ms, the class end)", () => {
  // A and B: end_ms + crossfade. C: the class end, before its own end and end_ms + crossfade.
  assert.deepEqual(T.stops, [106_000, 206_000, 290_000]);
  // Its own end comes first when the file is shorter than end_ms + crossfade.
  assert.deepEqual(localTimingOf([{ startMs: 0, endMs: 100_000, lengthMs: 103_000 }], XF, 290_000).stops, [103_000]);
  // Never later than the song after next starts: at most two songs sound at once.
  const close = localTimingOf([{ startMs: 0, endMs: 10_000, lengthMs: 100_000 }, { startMs: 5_000, endMs: 20_000, lengthMs: 100_000 }, { startMs: 8_000, endMs: 30_000, lengthMs: 100_000 }], 50_000, 290_000);
  assert.equal(close.stops[0], 8_000);
  for (let t = 0; t < 100_000; t += 500) assert.ok(activeAt(close, t).length <= 2, String(t));
  // A song that would start after the class end never sounds.
  const late = localTimingOf([{ startMs: 0, endMs: 100_000, lengthMs: 100_000 }, { startMs: 300_000, endMs: 400_000, lengthMs: 100_000 }], XF, 290_000);
  assert.equal(late.stops[1], 300_000);
  assert.deepEqual(activeAt(late, 300_000), []);
});

test("start and stop: a song sounds from start_ms up to, not at, its stop", () => {
  assert.deepEqual(activeAt(T, 0), [0]);
  assert.deepEqual(activeAt(T, 99_999), [0]);
  assert.deepEqual(activeAt(T, 100_000), [0, 1]);
  assert.deepEqual(activeAt(T, 105_999), [0, 1]);
  assert.deepEqual(activeAt(T, 106_000), [1]);
  assert.deepEqual(activeAt(T, 289_999), [2]);
  assert.deepEqual(activeAt(T, 290_000), []);
});

test("the incoming song owns the overlap (ADR 0001 rule 3), and class time is music time held at the owner's end_ms", () => {
  assert.equal(ownerAt(T, 99_999), 0);
  for (const t of [100_000, 103_000, 105_999]) assert.equal(ownerAt(T, t), 1, String(t));
  assert.equal(ownerAt(T, 290_000), null);
  assert.equal(classTimeOf(T, 103_000), 103_000);
  // A song whose end_ms comes before the next song starts holds class time at its end_ms while it plays on.
  const gap = localTimingOf([{ startMs: 0, endMs: 95_000, lengthMs: 120_000 }, { startMs: 100_000, endMs: 200_000, lengthMs: 120_000 }], XF, 290_000);
  assert.equal(ownerAt(gap, 98_000), 0);
  assert.equal(classTimeOf(gap, 98_000), 95_000);
  assert.equal(classTimeOf(gap, 100_500), 100_500);
  // Never past the class end, never below 0.
  assert.equal(classTimeOf(T, 400_000), 290_000);
  assert.equal(classTimeOf(T, -5), 0);
});

test("song k always plays in slot k % 2, so two overlapping songs are never in the same element", () => {
  assert.deepEqual(slotsAt(T, 50_000), [0, null]);
  assert.deepEqual(slotsAt(T, 103_000), [0, 1]);
  assert.deepEqual(slotsAt(T, 150_000), [null, 1]);
  assert.deepEqual(slotsAt(T, 203_000), [2, 1]);
  assert.deepEqual(slotsAt(T, 290_000), [null, null]);
});

test("the fades: the outgoing song fades out and the incoming fades in over the same overlap, in each song's own positions", () => {
  assert.deepEqual(fadeOf(T, 0), { inToMs: 0, outFromMs: 100_000, stopMs: 106_000 });
  assert.deepEqual(fadeOf(T, 1), { inToMs: 6_000, outFromMs: 100_000, stopMs: 106_000 });
  // The last song fades in and has no fade out: it stops at the class end.
  assert.deepEqual(fadeOf(T, 2), { inToMs: 6_000, outFromMs: 90_000, stopMs: 90_000 });
});

test("the crossfade is equal power: the two gains' squares add to 1 across the overlap", () => {
  const out = fadeOf(T, 0);
  const inc = fadeOf(T, 1);
  for (let t = 100_000; t < 106_000; t += 250) {
    const a = gainAt(t, out);
    const b = gainAt(t - 100_000, inc);
    assert.ok(Math.abs(a * a + b * b - 1) < 1e-9, String(t));
  }
  assert.ok(Math.abs(gainAt(103_000, out) - Math.SQRT1_2) < 1e-9);
  assert.equal(gainAt(50_000, out), 1);
  assert.equal(gainAt(0, inc), 0);
  assert.equal(gainAt(106_000, out), 0);
  for (const bad of [-1, Number.NaN]) assert.equal(gainAt(bad, out), 0);
  // No fade at all: full gain up to the stop.
  assert.equal(gainAt(89_999, fadeOf(T, 2)), 1);
});
