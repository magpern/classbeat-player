// Which frames of a run the scheduler marks (scene.md "Steady light, measured"): a frame is marked when `planMarks` (marks-calc.ts, the one
// placement the canvas's runs and the text layer share) has a mark in the time since the frame before it. Nothing else is a mark: not a
// phrase flip, a gather or a fixture switching on. The steady gate (tools/steady-shots.ts) takes out the jump on a marked frame only. Pure.

import { planMarks } from "./marks-calc.ts";
import type { Where } from "./marks-calc.ts";

/**
 * Whether `planMarks` places a mark in (`fromMs`, `toMs`], the frame that ends at `toMs` (class clock). `w.cls` is the class as the loop
 * has it, interval changes under 1 s apart merged (P1, `mergeIntervals`): the caller merges it once, this keeps no state.
 */
export function plannedMarkIn(w: Where, fromMs: number, toMs: number): boolean {
  return planMarks({ ...w, classMs: toMs }, toMs).marks.some((m) => m > fromMs && m <= toMs);
}
