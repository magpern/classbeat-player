// What the screens get from the clock (ADR 0001 rules 1, 6 and 7 for the manual clock) and the
// plan read from a class document.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createClock, planFrom, spanIndexAt, start, tick, viewAt } from "../../src/core/clock/index.ts";
import { loadExample } from "./fixtures.ts";

const doc = loadExample("valid/class-45min-crossfade-9s.json");

test("plan: intervals and song windows come from the document (rule 1: windows as stated)", () => {
  const plan = planFrom(doc);
  assert.equal(plan.lengthMs, doc.class.length_ms);
  assert.equal(plan.intervals.length, doc.intervals.length);
  assert.deepEqual(plan.intervals[0], { startMs: 0, endMs: doc.intervals[0].length_ms });
  assert.deepEqual(
    plan.songs,
    doc.songs.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms })),
  );
  assert.equal(plan.plannedCrossfadeMs, 9000);
  assert.equal(plan.manualOnly, false);
});

test("plan: song timing missing means manual only and no song windows (ADR 0003 section 5)", () => {
  const plan = planFrom(loadExample("valid/class-song-timing-missing.json"));
  assert.equal(plan.manualOnly, true);
  assert.deepEqual(plan.songs, []);
});

test("plan: a class without music is manual only", () => {
  const plan = planFrom(loadExample("valid/short-class-no-music.json"));
  assert.equal(plan.manualOnly, true);
  assert.deepEqual(plan.songs, []);
});

const SPANS = [
  { startMs: 0, endMs: 10 },
  { startMs: 10, endMs: 30 },
  { startMs: 30, endMs: 31 },
];
for (const [ms, index] of [
  [0, 0],
  [9, 0],
  [10, 1],
  [29, 1],
  [30, 2],
  [31, 2],
  [1000, 2],
] as const) {
  test(`spanIndexAt(${ms}) is ${index}`, () => assert.equal(spanIndexAt(SPANS, ms), index));
}
test("spanIndexAt of no spans is -1", () => assert.equal(spanIndexAt([], 5), -1));

test("view: interval countdown, next interval and time left (rule 7: the class left)", () => {
  const plan = planFrom(doc);
  const first = doc.intervals[0].length_ms;
  const s = tick(start(createClock(plan.lengthMs, 0), 0), first + 1500);
  const v = viewAt(s, plan, first + 1500);
  assert.equal(v.mode, "manual");
  assert.equal(v.classMs, first + 1500);
  assert.equal(v.intervalIndex, 1);
  assert.equal(v.intervalElapsedMs, 1500);
  assert.equal(v.intervalRemainingMs, doc.intervals[1].length_ms - 1500);
  assert.equal(v.nextIntervalIndex, 2);
  assert.equal(v.classRemainingMs, plan.lengthMs - first - 1500);
  assert.equal(v.holding, false);
  assert.equal(v.plannedCrossfadeMs, 9000);
  assert.equal(v.measuredCrossfadeMs, null);
  assert.equal(v.songIndex, spanIndexAt(plan.songs, first + 1500));
});

test("view: the song window follows class time", () => {
  const plan = planFrom(doc);
  const second = doc.songs[1].start_ms;
  const s = tick(start(createClock(plan.lengthMs, 0), 0), second);
  assert.equal(viewAt(s, plan, second).songIndex, 1);
});

test("rule 6: at the class end the last interval stays on screen with its cue, holding", () => {
  const plan = planFrom(doc);
  const s = tick(start(createClock(plan.lengthMs, 0), 0), plan.lengthMs + 60_000);
  const v = viewAt(s, plan, plan.lengthMs + 60_000);
  assert.equal(v.status, "ended");
  assert.equal(v.holding, true);
  assert.equal(v.intervalIndex, doc.intervals.length - 1);
  assert.equal(v.intervalRemainingMs, 0);
  assert.equal(v.classRemainingMs, 0);
  assert.equal(v.nextIntervalIndex, null);
});

test("view: no song windows give no song index", () => {
  const plan = planFrom(loadExample("valid/short-class-no-music.json"));
  assert.equal(viewAt(createClock(plan.lengthMs, 0), plan, 0).songIndex, null);
});
