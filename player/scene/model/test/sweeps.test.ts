// The foreseen turns of a song (scene.md "Steady light and sweeps", the scheduler's step a): each turn's first frame, on the demo class's songs
// and at the tempos that bend the plan. The spans the beams move in black over are tested in dark.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitRuns } from "../src/flash-runs.ts";
import type { Room, RunWish } from "../src/flash-runs.ts";
import type { SceneSong } from "../src/frame.ts";
import { HOLD_STILL_MS, SWEEP_WINDOW_MS, songChangeSweep, songSweeps } from "../src/sweeps.ts";

// The demo class's songs (render/demo/scenario.ts): 120 bpm with drops at 40 s and 58 s, ending at 60 s; 128 bpm with none.
const SONG0: SceneSong = { bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }], moments: [{ at_ms: 40_000, kind: "drop" }, { at_ms: 58_000, kind: "drop" }], lengthMs: 60_000 };
const SONG1: SceneSong = { bpm: 128, anchors: [{ at_ms: 0, bpm: 128 }], lengthMs: 40_000 };
const starts = (s: readonly { cause: string; fromMs: number }[]) => s.map((w) => `${w.cause} ${w.fromMs}`);

test("a turn's part is at most 4.15 s: the longest turn, 3.5 s, and the 650 ms delay", () => {
  assert.equal(SWEEP_WINDOW_MS, 3500 + 650);
  assert.deepEqual(starts([songChangeSweep(60_000)]), ["song change 60000"]);
});

test("the demo song's turns: flips, the gather 650 ms into the build, the fan's turn at 2250 ms, none for the 58 s drop", () => {
  assert.deepEqual(starts(songSweeps(SONG0, 0, 0, 100_000)), ["flip 16000", "flip 32000", "gather 36650", "fan 42250", "flip 48000", "fan end 48650", "gather 54650"]);
  assert.deepEqual(starts(songSweeps(SONG1, 60_000, 60_000, 100_000)), ["flip 75000", "flip 90000"], "song 1 starts at 60 s: its flips at 15 s and 30 s, none past its length");
  assert.equal(songSweeps(SONG0, 0, 0, 100_000).find((s) => s.cause === "gather")?.holdStillMs, 39_000, "a drop's gather holds still 1 s before it");
  assert.equal(HOLD_STILL_MS, 1000);
});

test("the plan is a function of the song: a turn whose part overlaps the range is in it, one outside is not", () => {
  assert.deepEqual(starts(songSweeps(SONG0, 0, 20_150, 31_000)), []);
  assert.deepEqual(starts(songSweeps(SONG0, 0, 20_149, 31_000)), ["flip 16000"]);
  assert.deepEqual(starts(songSweeps(SONG0, 0, 0, 16_000)), []);
  assert.deepEqual(starts(songSweeps(undefined, 0, 0, 100_000)), []);
  assert.deepEqual(starts(songSweeps({ bpm: 120 }, 0, 0, 100_000)), [], "no anchors, no flips; no moments, no turns");
});

test("a gather starts 650 ms after 8 beats before its drop, at every tempo; a build's, 650 ms after its moment", () => {
  const gather = (bpm: number) => starts(songSweeps({ bpm, anchors: [], moments: [{ at_ms: 100_000, kind: "drop" }], lengthMs: 200_000 }, 0, 0, 200_000).filter((s) => s.cause === "gather"));
  assert.deepEqual(gather(120), ["gather 96650"]);
  assert.deepEqual(gather(60), ["gather 92650"]);
  assert.deepEqual(gather(240), ["gather 98650"]);
  assert.deepEqual(starts(songSweeps({ bpm: 120, moments: [{ at_ms: 10_000, kind: "build" }] }, 0, 0, 100_000)), ["gather 10650", "gather end 14650"], "a build's gather, and the turn that leaves it");
});

test("a drop less than 2.25 s before its song's end has no fan turn and no turn out of one", () => {
  const drop = (at: number) => starts(songSweeps({ bpm: 120, moments: [{ at_ms: at, kind: "drop" }], lengthMs: 60_000 }, 0, 0, 100_000).filter((s) => s.cause.startsWith("fan")));
  assert.deepEqual(drop(58_000), []);
  assert.deepEqual(drop(57_751), []);
  assert.deepEqual(drop(40_000), ["fan 42250", "fan end 48650"]);
  assert.deepEqual(drop(53_000), ["fan 55250"], "a fan that would end after the song has no turn out of it");
});

const room = (over: Partial<Room> = {}): Room => ({ marks: [80_000], beat: [], count: [], beatMs: 500, endMs: 120_000, frameMs: 1000 / 60, ...over });
const light: RunWish = { id: "light@80000", kind: "lightBurst", pieces: [{ fromMs: 80_017, toMs: 80_250 }] };
const win = (fromMs: number, toMs: number) => ({ fromMs, toMs });

test("the scheduler places the burst and records the step it moved into the rise frame; the span stays closed to every other run", () => {
  const flip = { ...win(75_000, 79_150), swayAfter: false }; // a gather's: dark from 75.0 s to its on-step at 79.15 s, 0.87 s before the decay
  const plan = fitRuns([light], room({ sweepWindows: [flip] }));
  assert.deepEqual(plan.runs.map((r) => r.wish.id), ["light@80000"]);
  assert.equal(plan.cuts.length, 1);
  assert.deepEqual([plan.cuts[0]!.kind, plan.cuts[0]!.id, plan.cuts[0]!.offMs], ["b7", "light@80000", 75_000]);
  assert.ok(Math.abs(plan.cuts[0]!.onMs - (80_017 - 1000 / 60)) < 1e-6, "B7: the light comes on in the rise frame, the frame before the decay's first");
  const ramp: RunWish = { id: "ramp", kind: "ramp", pieces: [{ fromMs: 79_050, toMs: 79_140 }] };
  const beat = [win(0, 200_000)];
  assert.deepEqual(fitRuns([ramp], room({ beat, sweepWindows: [flip] })).steps.map((w) => w.id), ["ramp"], "a ramp in the span is a step");
  assert.deepEqual(fitRuns([ramp], room({ beat })).runs.map((r) => r.wish.id), ["ramp"], "and a run wherever no span is");
  assert.deepEqual(fitRuns([light], room({ sweepWindows: [win(79_000, 80_100)] })).skipped.map((w) => w.id), ["light@80000"], "a span that holds the decay: the burst is skipped");
});

test("no run lies in a span or within 1 s of its steps: a ramp 1 s after the on-step is a run, 0.9 s after it a step; the same before the off-step", () => {
  const ramp = (at: number): RunWish => ({ id: "r", kind: "ramp", pieces: [{ fromMs: at, toMs: at + 300 }] });
  const beat = [win(0, 200_000)];
  const span = win(10_000, 12_000);
  const ids = (at: number) => fitRuns([ramp(at)], room({ marks: [], beat, sweepWindows: [span] })).runs.length;
  assert.deepEqual([ids(12_900), ids(13_000), ids(8_701), ids(8_700)], [0, 1, 0, 1]);
});

test("steps e and f place a burst with its step in the rise frame whatever follows the span: a B7 after a flip or a gather, a B8 before a turn (the sway skip is the budget's, at the Beat level and Tempo only)", () => {
  const plan = (w: { fromMs: number; toMs: number; swayAfter?: boolean }) => fitRuns([light], room({ sweepWindows: [w] }));
  for (const swayAfter of [true, false]) {
    const b7 = plan({ ...win(75_000, 79_150), swayAfter });
    assert.deepEqual([b7.runs.length, b7.cuts.map((c) => c.kind)], [1, ["b7"]], `B7, sway after ${swayAfter}`);
  }
  const b8 = plan(win(80_700, 83_000));
  assert.deepEqual([b8.runs.length, b8.cuts.map((c) => c.kind)], [1, ["b8"]], "B8: the beams go dark in the rise frame");
  assert.equal(plan(win(75_000, 77_600)).cuts.length, 0, "no step near the decay: nothing moves");
  assert.equal(plan(win(79_000, 80_100)).skipped.length, 1, "a decay inside a span is skipped for that");
});
