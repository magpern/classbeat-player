// Interval changes less than 1 s apart are one change frame (docs/design/room-2d.md, "Merged
// intervals"; scene.md, text rule 2, P1): at the first change's time the screen shows the latest of
// them, so a merged-away interval is absent everywhere but its own score block. The grouping is the
// scheduler's (flash-marks.ts, merged in #590); this only applies it to a clock view. Pure.
import { fixedFrames } from "../../../player/scene/model/src/flash-marks.ts";
import type { Class, ClockInput } from "./input.ts";

/** The view the screen shows: while the clock is between a merged change's first and last times, the latest interval's. */
export function mergedView(doc: Class, view: ClockInput): ClockInput {
  const starts = doc.intervals.slice(1).map((iv) => iv.start_ms);
  for (const f of fixedFrames(starts, [], 1)) {
    const first = f.changes[0];
    const last = f.changes.at(-1);
    if (first === undefined || last === undefined || last === first || view.classMs < first || view.classMs >= last) continue;
    const index = doc.intervals.findIndex((iv) => iv.start_ms === last);
    const iv = doc.intervals[index];
    if (!iv) break;
    return {
      ...view,
      intervalIndex: index,
      intervalRemainingMs: Math.max(0, iv.start_ms + iv.length_ms - view.classMs),
      nextIntervalIndex: index + 1 < doc.intervals.length ? index + 1 : null,
    };
  }
  return view;
}
