// Which frames of a run the scheduler marks (scene.md "Steady light, measured"): a frame is marked when `planMarks` (marks-calc.ts, the one
// placement the canvas's runs and the text layer share) has a mark in the time since the frame before it. Nothing else is a mark: not a
// phrase flip, a gather or a fixture switching on. The steady gate (tools/steady-shots.ts) takes out the jump on a marked frame only. Pure.

import type { SceneClass } from "../../model/src/index.ts";
import { mergeIntervals } from "../../model/src/index.ts";
import { planMarks } from "./marks-calc.ts";
import type { Where } from "./marks-calc.ts";

/** The class merged last: a run asks about one class, frame after frame. */
let last: { readonly from: SceneClass; readonly merged: SceneClass } | null = null;

/** Whether `planMarks` places a mark in (`fromMs`, `toMs`], the frame that ends at `toMs` (class clock). Interval changes under 1 s apart are one frame (P1). */
export function plannedMarkIn(w: Where, fromMs: number, toMs: number): boolean {
  if (last?.from !== w.cls) last = { from: w.cls, merged: mergeIntervals(w.cls) };
  return planMarks({ ...w, cls: last.merged, classMs: toMs }, toMs).marks.some((m) => m > fromMs && m <= toMs);
}
