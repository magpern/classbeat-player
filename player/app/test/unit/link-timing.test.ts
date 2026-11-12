// The measured crossfade, the elastic last interval and the totals (ADR 0001 rules 6 and 7), as
// pure arithmetic and on scripted timelines. The first song starts at t = 1000.
import assert from "node:assert/strict";
import { test } from "node:test";
import { holdRemainingMs, measureCrossfade, timeLeftMs } from "../../src/core/link/index.ts";
import type { Observation } from "../../src/core/link/index.ts";
import { makePlan, play, run, SONG_MS, track } from "./link-harness.ts";

const song = makePlan(["A", "B"]).songs[0];
const obs = (positionMs: number, at: number, playing = true): Observation => ({ ...track("A"), positionMs, playing, at, seenAt: at });

const MEASURE: readonly { name: string; prev: Observation; incoming: Observation; expected: number | null }[] = [
  { name: "the planned 9 s", prev: obs(170_000, 1000), incoming: obs(0, 2000), expected: 9000 },
  { name: "a shorter 5 s", prev: obs(170_000, 1000), incoming: obs(0, 6000), expected: 5000 },
  { name: "crossfade off: 0", prev: obs(170_000, 1000), incoming: obs(0, 11_000), expected: 0 },
  { name: "the incoming song seen a little late: its position carries its own time", prev: obs(170_000, 1000), incoming: obs(2000, 4000), expected: 9000 },
  { name: "a hair past the length is rounded to 0", prev: obs(171_000, 1000), incoming: obs(0, 11_000), expected: 0 },
  { name: "well past the length is not believed", prev: obs(171_000, 1000), incoming: obs(0, 12_000), expected: null },
  { name: "the outgoing song was paused: unknown", prev: obs(170_000, 1000, false), incoming: obs(0, 2000), expected: null },
  { name: "the incoming song was first seen long after it started: unknown", prev: obs(170_000, 1000), incoming: obs(20_000, 22_000), expected: null },
  { name: "the outgoing reading is too old: unknown", prev: obs(170_000, 1000), incoming: obs(0, 21_000), expected: null },
  { name: "a skip far from the end is no crossfade: unknown", prev: obs(100_000, 1000), incoming: obs(0, 2000), expected: null },
  { name: "the incoming song started before the outgoing reading: unknown", prev: obs(170_000, 1000), incoming: obs(0, 500), expected: null },
];
for (const c of MEASURE) {
  test(`measured crossfade: ${c.name}`, () => assert.equal(measureCrossfade(song, c.prev, c.incoming), c.expected));
}

const HOLD: readonly { name: string; pos: number; crossfade: number; last: boolean; expected: number }[] = [
  { name: "planned crossfade, already past the window: the next song is late, no countdown left", pos: 175_000, crossfade: 9000, last: false, expected: 0 },
  { name: "measured crossfade off: the song's own end is the wait", pos: 175_000, crossfade: 0, last: false, expected: 5000 },
  { name: "a 5 s crossfade measured", pos: 172_000, crossfade: 5000, last: false, expected: 3000 },
  { name: "the last song has no next one: its own end", pos: 175_000, crossfade: 9000, last: true, expected: 5000 },
  { name: "never negative", pos: 190_000, crossfade: 0, last: true, expected: 0 },
];
for (const c of HOLD) {
  test(`rule 6: the elastic countdown, ${c.name}`, () => assert.equal(holdRemainingMs(SONG_MS, c.pos, c.crossfade, c.last), c.expected));
}

const LEFT: readonly { name: string; song: number | null; measured: number | null; hold: number | null; classMs: number; expected: number }[] = [
  { name: "no song followed: the class left", song: null, measured: null, hold: null, classMs: 100_000, expected: 593_000 },
  { name: "nothing measured yet: the windows as planned", song: 0, measured: null, hold: null, classMs: 100_000, expected: 593_000 },
  { name: "crossfade off measured: each remaining change holds 9 s", song: 0, measured: 0, hold: null, classMs: 100_000, expected: 593_000 + 3 * 9000 },
  { name: "a 15 s crossfade measured: each remaining change skips 6 s", song: 0, measured: 15_000, hold: null, classMs: 100_000, expected: 593_000 - 3 * 6000 },
  { name: "in the last song no change is left", song: 3, measured: 0, hold: null, classMs: 600_000, expected: 93_000 },
  { name: "holding: the countdown plus the later changes", song: 1, measured: 0, hold: 5000, classMs: 342_000, expected: 351_000 + 5000 + 9000 },
  { name: "never below zero", song: 0, measured: 30_000, hold: null, classMs: 690_000, expected: 0 },
];
for (const c of LEFT) {
  test(`rule 7: time left, ${c.name}`, () => {
    const left = timeLeftMs({ lengthMs: 693_000, classMs: c.classMs, songIndex: c.song, songCount: 4, plannedCrossfadeMs: 9000, measuredCrossfadeMs: c.measured, holdRemainingMs: c.hold });
    assert.equal(left, c.expected);
  });
}

const plan = makePlan(["A", "B", "C", "D"]);

// Song B starts when A is `at` ms in; the real crossfade is then 180 s minus that.
for (const [name, bStart, measured, differs] of [
  ["the planned 9 s", 1000 + 171_000, 9000, false],
  ["off", 1000 + 180_000, 0, true],
  ["5 s", 1000 + 175_000, 5000, true],
  ["12 s, Spotify's longest", 1000 + 168_000, 12_000, true],
] as const) {
  test(`rule 7: the crossfade measured at a song change, ${name}, is shown beside the planned one`, () => {
    const t = run({ plan, segments: [play(1000, "A", 0), play(bStart, "B", 0)], until: bStart + 2000 });
    assert.equal(t.at(bStart - 100).view.measuredCrossfadeMs, null);
    assert.equal(t.at(bStart).view.measuredCrossfadeMs, measured);
    assert.equal(t.at(bStart).view.plannedCrossfadeMs, 9000);
    assert.equal(t.at(bStart).view.crossfadeDiffers, differs, "the player says when they differ");
  });
}

test("over 13.5 s of overlap is a skip, not a crossfade: nothing is measured and the plan stands", () => {
  // B starts when A is at 165 s: 15 s of overlap, more than Spotify's 12 s plus tolerance.
  const t = run({ plan, segments: [play(1000, "A", 0), play(1000 + 165_000, "B", 0)], until: 1000 + 167_000 });
  assert.equal(t.at(1000 + 167_000).view.measuredCrossfadeMs, null);
  assert.equal(t.at(1000 + 167_000).view.crossfadeDiffers, false);
});

test("a skip is not a crossfade: nothing is measured", () => {
  const t = run({ plan, segments: [play(1000, "A", 0), play(51_000, "B", 0)], until: 53_000 });
  assert.equal(t.at(53_000).view.measuredCrossfadeMs, null);
});

test("rule 6: during a hold the last interval's countdown is the time until the next song is expected", () => {
  // Crossfade off in the room: B starts when A ends (t = 181 s), C when B ends (t = 361 s).
  const t = run({ plan, segments: [play(1000, "A", 0), play(181_000, "B", 0), play(361_000, "C", 0)], until: 365_000, stepMs: 500 });
  // First hold, planned crossfade: A's next song was due at 171 s into A: nothing left to count.
  assert.equal(t.at(176_000).view.held, true);
  assert.equal(t.at(176_000).view.holdRemainingMs, 0);
  // Second hold, measured crossfade 0: B's next song is due at its own end, 5 s from 175 s in.
  assert.equal(t.at(181_000).view.measuredCrossfadeMs, 0);
  assert.equal(t.at(356_000).view.held, true);
  assert.equal(t.at(356_000).view.holdRemainingMs, 5000);
  assert.equal(t.at(358_000).view.holdRemainingMs, 3000);
  assert.equal(t.at(360_500).view.holdRemainingMs, 500);
  // The next song ends the hold: the clock continues from the window end.
  assert.equal(t.at(361_000).view.held, false);
  assert.equal(t.at(361_000).view.holdRemainingMs, null);
  assert.equal(t.at(361_000).classMs, 342_000);
});

test("rule 7: time left follows the measurement while the class plays", () => {
  const t = run({ plan, segments: [play(1000, "A", 0), play(181_000, "B", 0)], until: 183_000 });
  // Before the first change nothing is measured: the plan holds.
  assert.equal(t.at(100_000).view.classRemainingMs, 693_000 - 99_000);
  // After it: crossfade off measured, so the two remaining changes (B to C, C to D) hold 9 s each.
  assert.equal(t.at(182_000).view.classRemainingMs, 693_000 - 172_000 + 2 * 9000);
});

test("rule 7: a longer real crossfade shortens the time left", () => {
  // 12 s measured against 9 s planned: each of the two remaining changes skips 3 s.
  const t = run({ plan, segments: [play(1000, "A", 0), play(169_000, "B", 0)], until: 171_000 });
  assert.equal(t.at(170_000).view.measuredCrossfadeMs, 12_000);
  assert.equal(t.at(170_000).view.classRemainingMs, 693_000 - 172_000 - 2 * 3000);
});
