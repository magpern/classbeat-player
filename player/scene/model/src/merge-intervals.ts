// P1 for the rig (scene.md "The flash budget", text rule 2): interval changes less than 1 s apart are one change frame, at
// the first of them, which shows the latest (its colour, energy and values). The merged-away interval is absent for the
// rig: no cross, no ramp, no anticipation of it, and the next interval is the next one not merged away. Movement never
// merges: nothing here reads a direction. Pure.

import { fixedFrames } from "./flash-marks.ts";
import type { SceneClass, SceneInterval } from "./frame.ts";

/** The class with its interval changes merged by P1; the class itself (same object) when none are under 1 s apart. */
export function mergeIntervals(cls: SceneClass): SceneClass {
  const [first, ...rest] = cls.intervals;
  if (first === undefined || rest.length < 2) return cls;
  const frames = fixedFrames(rest.map((iv) => iv.startMs), [], 1e-3).filter((f) => f.change);
  if (frames.length === rest.length) return cls;
  const merged = frames.map((f): SceneInterval => {
    const latest = rest.find((iv) => iv.startMs === f.changes.at(-1)) ?? rest[0]!;
    return { ...latest, startMs: f.changes[0]! };
  });
  return { ...cls, intervals: [first, ...merged] };
}
