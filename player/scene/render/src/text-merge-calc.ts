// P1 for the text layer (scene.md "The flash budget", text rule 2): interval changes less than 1 s apart are one change
// frame, at the first of them, which shows the latest (its number, name, cue, values and length). A merged-away interval
// is absent everywhere in the text (the gel, the countdown, the next row, the pattern block): the next interval is the
// next one not merged away. Only the score keeps its own block for it, as wide as its length, with no number and no
// colour (S3, S5). Pure.

import { fixedFrames } from "../../model/src/index.ts";
import type { TextClass, TextInterval } from "./text-types.ts";

/** The class with its interval changes merged by P1; the class itself (same object) when none are under 1 s apart. */
export function mergeTextClass(cls: TextClass): TextClass {
  const [first, ...rest] = cls.intervals;
  if (first === undefined || rest.length < 2) return cls;
  const frames = fixedFrames(rest.map((iv) => iv.startMs), [], 1e-3).filter((f) => f.change);
  if (frames.length === rest.length) return cls;
  const away: number[] = [];
  const merged = frames.map((f): TextInterval => {
    const members = rest.filter((iv) => f.changes.includes(iv.startMs));
    const latest = members.at(-1) ?? rest[0]!;
    away.push(...members.slice(0, -1).map((iv) => iv.startMs));
    return { ...latest, startMs: f.changes[0]!, lengthMs: latest.startMs + latest.lengthMs - f.changes[0]! };
  });
  return { ...cls, intervals: [first, ...merged], score: { intervals: cls.intervals, away } };
}
