// P1 for the rig: interval changes under 1 s apart are one change frame at the first, showing the latest.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeIntervals } from "../src/merge-intervals.ts";
import type { SceneClass } from "../src/frame.ts";

const cls = (...starts: [number, number][]): SceneClass => ({ songs: [], endMs: 200_000, intervals: [{ startMs: 0, zone: 1 }, ...starts.map(([startMs, zone]) => ({ startMs, zone }))] });
const shape = (c: SceneClass) => c.intervals.map((iv) => [iv.startMs, iv.zone]);

test("changes under 1 s apart merge into the first one's frame and show the latest's zone; 1 s or more apart stay", () => {
  assert.deepEqual(shape(mergeIntervals(cls([20_000, 2], [20_400, 3], [40_000, 4]))), [[0, 1], [20_000, 3], [40_000, 4]]);
  assert.deepEqual(shape(mergeIntervals(cls([20_000, 2], [20_999, 3], [21_998, 4]))), [[0, 1], [20_000, 3], [21_998, 4]], "chained from the frame, not the last change");
  assert.deepEqual(shape(mergeIntervals(cls([20_000, 2], [21_000, 3]))), [[0, 1], [20_000, 2], [21_000, 3]]);
});

test("nothing to merge returns the class itself; the first interval is never a change", () => {
  const a = cls([20_000, 2], [40_000, 3]);
  assert.equal(mergeIntervals(a), a);
  const b = cls([300, 2], [900, 3]);
  assert.deepEqual(shape(mergeIntervals(b)), [[0, 1], [300, 3]]);
});
