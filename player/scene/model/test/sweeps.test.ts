// The sweeps' planned windows (up to 4.15 s from the turn's first frame) and the cut a placed burst makes in one (scene.md "Steady
// light and sweeps", "A burst cuts a sweep's window"), on the demo class's songs and on the tempos that bend the plan.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitRuns } from "../src/flash-runs.ts";
import type { Room, RunWish } from "../src/flash-runs.ts";
import type { SceneSong } from "../src/frame.ts";
import { DECAY_CLEAR_MS, SWEEP_WINDOW_MS, cutByDecay, songChangeSweep, songSweeps } from "../src/sweeps.ts";

// The demo class's songs (render/demo/scenario.ts): 120 bpm with drops at 40 s and 58 s, ending at 60 s; 128 bpm with none.
const SONG0: SceneSong = { bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }], moments: [{ at_ms: 40_000, kind: "drop" }, { at_ms: 58_000, kind: "drop" }], lengthMs: 60_000 };
const SONG1: SceneSong = { bpm: 128, anchors: [{ at_ms: 0, bpm: 128 }], lengthMs: 40_000 };
const list = (s: readonly { cause: string; fromMs: number; toMs: number }[]) => s.map((w) => `${w.cause} ${w.fromMs}-${w.toMs}`);

test("the window is 4.15 s: the longest turn, 3.5 s, and the 650 ms delay", () => {
  assert.equal(SWEEP_WINDOW_MS, 3500 + 650);
  assert.deepEqual(list([songChangeSweep(60_000)]), ["song change 60000-64150"]);
});

test("the demo song's sweeps: flips from the turn's first frame, the gather to where the beams hold still, the fan's turn at 2250 ms, none for the 58 s drop", () => {
  assert.deepEqual(list(songSweeps(SONG0, 0, 0, 100_000)), [
    "flip 16000-20150",
    "flip 32000-36150",
    "gather 36650-39000", // 8 beats before the drop plus 650 ms, to 1 s before the drop
    "fan 42250-46400",
    "flip 48000-52150",
    "fan end 48650-52800", // the fan's 8 s plus 650 ms: the turn out of it is a sweep too
    "gather 54650-57000",
  ]);
  assert.deepEqual(list(songSweeps(SONG1, 60_000, 60_000, 100_000)), ["flip 75000-79150", "flip 90000-94150"], "song 1 starts at 60 s: its flips at 15 s and 30 s, none past its length");
});

test("the plan is a function of the song: a window that overlaps the range is in it, one outside is not", () => {
  assert.deepEqual(list(songSweeps(SONG0, 0, 20_150, 31_000)), []);
  assert.deepEqual(list(songSweeps(SONG0, 0, 20_149, 31_000)), ["flip 16000-20150"]);
  assert.deepEqual(list(songSweeps(SONG0, 0, 0, 16_000)), []);
  assert.deepEqual(list(songSweeps(undefined, 0, 0, 100_000)), []);
  assert.deepEqual(list(songSweeps({ bpm: 120 }, 0, 0, 100_000)), [], "no anchors, no flips; no moments, no turns");
});

test("a gather covers the longest turn and ends where the beams hold still, 1 s before the drop, at every tempo", () => {
  const gather = (bpm: number) => list(songSweeps({ bpm, anchors: [], moments: [{ at_ms: 100_000, kind: "drop" }], lengthMs: 200_000 }, 0, 0, 200_000).filter((s) => s.cause === "gather"));
  assert.deepEqual(gather(120), ["gather 96650-99000"]);
  assert.deepEqual(gather(60), ["gather 92650-96800"], "8 s of build: the window is the 4.15 s, not the whole build");
  assert.deepEqual(gather(240), ["gather 98650-99000"], "2 s of build: the turn starts 650 ms in and holds still 1 s before the drop");
  assert.deepEqual(gather(300), [], "1.6 s of build: the turn would start after the hold-still begins, no window");
  assert.deepEqual(list(songSweeps({ bpm: 120, moments: [{ at_ms: 10_000, kind: "build" }] }, 0, 0, 100_000)), ["gather 10650-14800", "gather end 14650-18800"], "a build's gather, and the turn that leaves it");
});

test("a drop less than 2.25 s before its song's end has no fan turn and no turn out of one", () => {
  const drop = (at: number) => list(songSweeps({ bpm: 120, moments: [{ at_ms: at, kind: "drop" }], lengthMs: 60_000 }, 0, 0, 100_000).filter((s) => s.cause.startsWith("fan")));
  assert.deepEqual(drop(58_000), []);
  assert.deepEqual(drop(57_751), []);
  assert.deepEqual(drop(40_000), ["fan 42250-46400", "fan end 48650-52800"]);
  assert.deepEqual(drop(53_000), ["fan 55250-59400"], "a fan that would end after the song has no turn out of it");
});

const DECAY = { fromMs: 80_017, toMs: 80_250 };
const win = (fromMs: number, toMs: number) => ({ fromMs, toMs });
const cutOf = (w: { fromMs: number; toMs: number }, d = DECAY) => { const c = cutByDecay(w, d); return c.kind === "cut" ? c.counted : c.kind; };

test("a window that ends less than 1 s before the decay's first frame is cut to end 1 s before it; 1 s or more is clear (0.1, 0.5 and 0.9 s, and the edge)", () => {
  assert.equal(DECAY_CLEAR_MS, 1000);
  assert.deepEqual(cutOf(win(75_000, 79_150)), win(75_000, 79_017), "song 1's flip at 75 s plans to 79.15 s and is cut to 79.0 s");
  for (const gap of [100, 500, 900, 999]) assert.deepEqual(cutOf(win(75_000, DECAY.fromMs - gap)), win(75_000, DECAY.fromMs - 1000), `${gap} ms before`);
  assert.equal(cutOf(win(75_000, DECAY.fromMs - 1000)), "clear", "exactly 1 s before: clear");
  assert.equal(cutOf(win(75_000, DECAY.fromMs - 1001)), "clear");
  assert.deepEqual(cutOf(win(75_000, DECAY.fromMs)), win(75_000, DECAY.fromMs - 1000), "ending on the decay's first frame");
  assert.equal(cutOf(win(79_500, 79_900)), null, "a window shorter than the cut has nothing left");
});

test("a window that starts less than 1 s after the decay's last frame is cut to start 1 s after it; the window's other end, its start and its turn are not touched", () => {
  for (const gap of [0, 100, 500, 900, 999]) assert.deepEqual(cutOf(win(DECAY.toMs + gap, 90_000)), win(DECAY.toMs + 1000, 90_000), `${gap} ms after`);
  assert.equal(cutOf(win(DECAY.toMs + 1000, 90_000)), "clear");
  assert.equal(cutOf(win(DECAY.toMs + 600, DECAY.toMs + 900)), null);
  assert.equal(cutByDecay(win(80_100, 84_000), DECAY).kind, "overlaps", "a window that holds the decay is not cut: the burst is skipped");
  assert.equal(cutByDecay(win(79_000, 80_100), DECAY).kind, "overlaps");
  assert.equal(cutByDecay(win(79_000, 80_017), DECAY).kind, "cut", "touching the first frame is not overlapping it");
});

const room = (over: Partial<Room> = {}): Room => ({ marks: [80_000], beat: [], count: [], beatMs: 500, endMs: 120_000, frameMs: 1000 / 60, ...over });
const light: RunWish = { id: "light@80000", kind: "lightBurst", pieces: [{ fromMs: 80_017, toMs: 80_250 }] };

test("the scheduler places the burst and records the cut; the turn's frames outside the cut stay closed to every other run", () => {
  const flip = win(75_000, 79_150);
  const plan = fitRuns([light], room({ sweepWindows: [flip] }));
  assert.deepEqual(plan.runs.map((r) => r.wish.id), ["light@80000"]);
  assert.deepEqual(plan.cuts, [{ id: "light@80000", planned: flip, counted: win(75_000, 79_017) }], "the planned window is kept whole; its counted length is cut");
  const ramp: RunWish = { id: "ramp", kind: "ramp", pieces: [{ fromMs: 79_050, toMs: 79_140 }] };
  const beat = [win(0, 200_000)];
  assert.deepEqual(fitRuns([ramp], room({ beat, sweepWindows: [flip] })).steps.map((w) => w.id), ["ramp"], "a ramp in the flip's window is a step");
  assert.deepEqual(fitRuns([ramp], room({ beat })).runs.map((r) => r.wish.id), ["ramp"], "and a run wherever no window is");
  assert.deepEqual(fitRuns([light], room({ sweepWindows: [win(79_000, 80_100)] })).skipped.map((w) => w.id), ["light@80000"], "a window that holds the decay: the burst is skipped, nothing is cut");
});

test("every sweep is planned for 4.15 s: a ramp 4.1 s after a flip is a step, 4.2 s after it is a run", () => {
  const ramp = (at: number): RunWish => ({ id: "r", kind: "ramp", pieces: [{ fromMs: at, toMs: at + 300 }] });
  const beat = [win(0, 200_000)];
  assert.deepEqual(fitRuns([ramp(14_100)], room({ marks: [], beat, sweeps: [10_000] })).steps.length, 1);
  assert.deepEqual(fitRuns([ramp(14_150)], room({ marks: [], beat, sweeps: [10_000] })).runs.length, 1, "from the window's end");
});
