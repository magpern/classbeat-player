// The flash budget's scheduler, one table per collision rule (scene.md "The flash budget": text rule 2's P1 and P2,
// "Steps and runs", the scheduler's steps c to g). The property test (flash-schedule-property.test.ts) runs them on random timelines.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixedFrames, frameAt, placeMarks } from "../src/flash-marks.ts";
import type { Want } from "../src/flash-marks.ts";
import { fitRuns, holdOf, inHold, maxInASecond, steadyChanges } from "../src/flash-runs.ts";
import type { Room, RunWish, Span } from "../src/flash-runs.ts";

const F = 1000 / 60;
const summary = (frames: ReturnType<typeof fixedFrames>) => frames.map((f) => [Math.round(f.atMs), f.change, f.changes.length, f.drops.length]);

test("P1: interval changes less than 1 s after a merged frame merge into it, the next one 1 s or more after starts the next", () => {
  const cases: [string, number[], number[][]][] = [
    ["alone", [10_000], [[10_000, 1, 1]]],
    ["two within 1 s merge, the frame is the first", [10_000, 10_500], [[10_000, 1, 2]]],
    ["999 ms merges, 1000 ms does not", [10_000, 10_999], [[10_000, 1, 2]]],
    ["exactly 1 s starts the next", [10_000, 11_000], [[10_000, 1, 1], [11_000, 1, 1]]],
    ["the merge is chained from the frame, not from the last change", [10_000, 10_600, 11_100], [[10_000, 1, 2], [11_100, 1, 1]]],
    ["1 ms intervals all merge", [5000, 5001, 5002, 5003], [[5000, 1, 4]]],
  ];
  for (const [name, changes, want] of cases) assert.deepEqual(summary(fixedFrames(changes, [], 1)).map((r) => [r[0], Number(r[1]), r[2]]), want, name);
});

test("P1: a drop less than 1 s from a change frame joins it (the nearer one); the others chain into drop frames from the first", () => {
  const cases: [string, number[], number[], number[][]][] = [
    ["a drop 400 ms after the change joins it", [10_000], [10_400], [[10_000, 1, 1, 1]]],
    ["a drop 400 ms before the change joins it, on the change frame", [10_000], [9_600], [[10_000, 1, 1, 1]]],
    ["a drop exactly 1 s from the frame stands alone", [10_000], [11_000], [[10_000, 1, 1, 0], [11_000, 0, 0, 1]]],
    ["the nearer of two change frames", [10_000, 11_200], [10_900], [[10_000, 1, 1, 0], [11_200, 1, 1, 1]]],
    ["drops chain from the first: 1 s or more starts the next frame", [], [5000, 5500, 5999, 6000, 6100], [[5000, 0, 0, 3], [6000, 0, 0, 2]]],
  ];
  for (const [name, changes, drops, want] of cases) assert.deepEqual(summary(fixedFrames(changes, drops, 1)).map((r) => [r[0], Number(r[1]), r[2], r[3]]), want, name);
  const all = fixedFrames([1000, 1500, 9000], [1200, 4000, 4400, 9500], 1);
  for (let i = 1; i < all.length; i++) assert.ok(all[i]!.atMs - all[i - 1]!.atMs >= 1000, "fixed frames are at least 1 s apart");
});

test("frames: a mark is a multiple of the refresh period, never earlier than its time", () => {
  assert.equal(frameAt(0, F), 0);
  assert.ok(Math.abs(frameAt(1, F) - F) < 1e-9);
  assert.ok(frameAt(1234.5, F) >= 1234.5 && frameAt(1234.5, F) - 1234.5 < F);
});

const at = (wants: Want[], fixed: number[] = [], frameMs = 1) => placeMarks(fixedFrames(fixed, [], frameMs), wants, frameMs).map((p) => [p.how, p.atMs === null ? null : Math.round(p.atMs)]);
const tick = (atMs: number, periodMs = 1000): Want => ({ kind: "tick", atMs, periodMs });
const action = (atMs: number): Want => ({ kind: "action", atMs });

test("P2: a mark takes the earliest frame at least 500 ms from every placed mark, fixed frames included", () => {
  assert.deepEqual(at([tick(1000)]), [["own", 1000]]);
  assert.deepEqual(at([tick(1000), tick(1200)]), [["own", 1000], ["own", 1500]]);
  assert.deepEqual(at([tick(1200)], [1000]), [["own", 1500]], "500 ms after the change frame");
  assert.deepEqual(at([tick(700)], [1000]), [["own", 1500]], "500 ms from a fixed frame ahead too: after it, not before");
  assert.deepEqual(at([tick(500)], [1000]), [["own", 500]], "exactly 500 ms before it is allowed");
  assert.deepEqual(at([tick(501)], [1000]), [["own", 1500]], "499 ms before it is not");
});

test("P2: an action is placed before the ticks; too late (over 500 ms) it joins the nearest following fixed frame; fixed frames never move", () => {
  assert.deepEqual(at([action(1100)], [1000]), [["own", 1500]], "400 ms late: placed");
  assert.deepEqual(at([action(800)], [1000]), [["joined", 1000]], "the earliest frame 700 ms late: joins the change frame");
  assert.deepEqual(at([tick(1000), action(1000)]), [["own", 1500], ["own", 1000]], "the action goes first, the tick gives way");
  const [worked] = placeMarks(fixedFrames([], [10_700], 1), [action(10_100), tick(10_000)], 1);
  assert.equal(worked!.how, "own", "the worked case: an action at C + 0.1 beside a drop at C + 0.7 is 600 ms from it and needs no wait");
});

test("P2: a later action replaces a pending one in its placed frame (the latest state wins)", () => {
  assert.deepEqual(at([action(1000), action(1100), action(1300), action(1450)], [1000]), [["own", 1500], ["replaced", 1500], ["replaced", 1500], ["replaced", 1500]]);
  const placed = placeMarks(fixedFrames([], [], 1), [action(0), action(100), action(300)], 1);
  assert.deepEqual(placed.map((p) => [p.how, p.atMs]), [["own", 0], ["own", 500], ["replaced", 500]]);
});

test("P2: a tick too late (over its period) joins a fixed frame within a period, or is dropped; the value shows on the next mark", () => {
  assert.deepEqual(at([tick(900, 500)], [1000]), [["joined", 1000]], "late over its 500 ms period: joins the frame 100 ms ahead");
  assert.deepEqual(at([tick(900, 300)], [1300]), [["dropped", null]], "the fixed frame is 400 ms ahead, over its 300 ms period: dropped");
  assert.deepEqual(at([tick(1000, 300), tick(1100, 300)]), [["own", 1000], ["dropped", null]], "the second is 400 ms late over a 300 ms period and no fixed frame follows");
});

test("P2: a switch beat is placed before the other ticks, so it never gives way to them", () => {
  const placed = placeMarks(fixedFrames([], [], 1), [tick(1000, 500), { kind: "switch", atMs: 1100, periodMs: 500 }], 1);
  assert.deepEqual(placed.map((p) => [p.how, p.atMs]), [["dropped", null], ["own", 1100]]);
});

const room = (over: Partial<Room> = {}): Room => ({ marks: [], beat: [{ fromMs: 0, toMs: 60_000 }], count: [], beatMs: 500, endMs: 60_000, frameMs: F, ...over });
const ramp = (id: string, from: number, ms = 700, waits = false): RunWish => ({ id, kind: "ramp", pieces: [{ fromMs: from, toMs: from + ms }], waits });
const ids = (plan: ReturnType<typeof fitRuns>) => [plan.runs.map((r) => r.wish.id), plan.steps.map((w) => w.id), plan.skipped.map((w) => w.id)];

test("runs: with the beat and no count a ramp fits; with no beat or a count running every run is a step (rule 3, step d)", () => {
  assert.deepEqual(ids(fitRuns([ramp("a", 10_000)], room())), [["a"], [], []]);
  assert.deepEqual(ids(fitRuns([ramp("a", 10_000)], room({ beat: [] }))), [[], ["a"], []]);
  assert.deepEqual(ids(fitRuns([ramp("a", 10_000)], room({ beat: [{ fromMs: 0, toMs: 10_300 }] }))), [[], ["a"], []], "the beat is lost inside it");
  assert.deepEqual(ids(fitRuns([ramp("a", 10_000)], room({ count: [{ fromMs: 9000, toMs: 11_000 }] }))), [[], ["a"], []]);
});

test("runs: no mark falls inside a run (it may start on one, and end the frame before one); no run overlaps another", () => {
  assert.deepEqual(ids(fitRuns([ramp("a", 10_000)], room({ marks: [10_300] }))), [[], ["a"], []]);
  assert.deepEqual(ids(fitRuns([ramp("a", 10_000)], room({ marks: [10_000] }))), [["a"], [], []], "a mark on its first frame is not inside it");
  assert.deepEqual(ids(fitRuns([ramp("a", 10_000)], room({ marks: [10_700 - F] }))), [[], ["a"], []], "a mark on its last frame is inside it");
  assert.deepEqual(ids(fitRuns([ramp("a", 10_000, 700 - F)], room({ marks: [10_700] }))), [["a"], [], []], "the change frame after a ramp that ends on the frame before it");
  assert.deepEqual(ids(fitRuns([ramp("a", 10_000), ramp("b", 10_300)], room())), [["a"], ["b"], []]);
});

test("runs: a run that waits slides to the first gap that holds it; one that may not becomes a step", () => {
  const marks = [10_000, 10_500];
  const slid = fitRuns([ramp("w", 10_100, 600, true)], room({ marks }));
  assert.ok(slid.runs[0]!.pieces[0]!.fromMs > 10_500, "it starts after the second mark");
  assert.deepEqual(ids(fitRuns([ramp("n", 10_100, 600)], room({ marks }))), [[], ["n"], []]);
});

test("runs: a fourth change in a 1 s window is never made: steps become steps in a mark, bursts and dims are skipped, in the scheduler's order", () => {
  const marks = [10_000, 10_500]; // two marks in the window
  const burst: RunWish = { id: "burst", kind: "dropBurst", pieces: [{ fromMs: 10_017, toMs: 10_250 }] };
  const light: RunWish = { id: "light", kind: "lightBurst", pieces: [{ fromMs: 10_017, toMs: 10_250 }] };
  // Each fits alone beside two marks (3), but not both: the light-only burst (e) goes before the drop burst (f).
  assert.deepEqual(ids(fitRuns([burst, light], room({ marks }))), [["light"], [], ["burst"]]);
  const dim: RunWish = { id: "dim", kind: "dim", pieces: [{ fromMs: 10_100, toMs: 10_220 }, { fromMs: 10_600, toMs: 10_720 }] };
  assert.deepEqual(ids(fitRuns([dim], room({ marks }))), [[], [], ["dim"]], "the dim's two edges would make 4");
  assert.deepEqual(ids(fitRuns([dim], room({ marks: [5000] }))), [["dim"], [], []]);
  assert.deepEqual(ids(fitRuns([burst, dim], room({ marks: [10_000, 14_000] }))), [["burst"], [], ["dim"]], "a dim never starts inside the burst's run");
  const later: RunWish = { id: "later", kind: "dim", pieces: [{ fromMs: 12_000, toMs: 12_120 }, { fromMs: 12_600, toMs: 12_720 }] };
  assert.deepEqual(ids(fitRuns([burst, later], room({ marks: [10_000, 14_000] }))), [["burst", "later"], [], []]);
});

test("steady light: without the beat one possible change 1.73 s after the last rise, then every 3.3 s; in beats below 60 bpm; none with the beat", () => {
  assert.deepEqual(steadyChanges([{ fromMs: 0, toMs: 10_000 }], 10_000, 500), []);
  assert.deepEqual(steadyChanges([], 8000, 500).map(Math.round), [1730, 5030]);
  assert.deepEqual(steadyChanges([{ fromMs: 0, toMs: 2000 }], 6000, 500).map(Math.round), [3730]);
  assert.deepEqual(steadyChanges([], 8000, 2000).map(Math.round), [3460]);
  const p: Span[] = [{ fromMs: 0, toMs: 1 }];
  assert.equal(maxInASecond([...p, { fromMs: 999, toMs: 999 }]), 2);
  assert.equal(maxInASecond([{ fromMs: 0, toMs: 0 }, { fromMs: 1000, toMs: 1000 }]), 1, "a window of 1 s holds one of two marks 1 s apart");
});

test("the hold: beat-like light is at rest from 250 ms before a run until 300 ms after it", () => {
  const plan = fitRuns([ramp("a", 10_000)], room());
  assert.deepEqual(holdOf(plan.runs[0]!), { fromMs: 9750, toMs: 11_000 });
  assert.deepEqual([9749, 9750, 10_999, 11_000].map((t) => inHold(plan.runs, t)), [false, true, true, false]);
});
