// The scene changes only on a planned mark (scene.md "The flash budget", S6): the lit fixtures and the haze's gain are light the song's
// moments move at the moment's own time (a breakdown's end, a drop's fan ending, a build ending), and that time is not always a mark. A change
// that falls between marks waits and lands on the next frame `planMarks` marks (an interval change, a drop's frame, a countdown second), so
// no new mark is made and P1 and P2 are untouched. A seek, a jump, a change of `context` (the quality level, the stage, the link state, reduced motion) and the first frame pass through: they are marks of their own.
// Light only: no angle is held here (S7, rule 4). Pure: a frame's target and its time come in.

import { plannedMarkIn } from "./frame-marks-calc.ts";
import type { Where } from "./marks-calc.ts";

/** A haze gain that falls by more than this in a frame is a build ending (the rise is 1 % a second). */
const HAZE_DROP = 0.005;
/** A step in class time of more than this is a seek or a jump, a mark of its own. */
const JUMP_MS = 250;

export interface Held {
  readonly lit: readonly boolean[];
  readonly haze: number;
}

const same = (a: readonly boolean[], b: readonly boolean[]): boolean => a.length === b.length && a.every((x, i) => x === b.at(i));

export class MarkHold {
  private held: Held | null = null;
  private prevMs = 0;
  private context = "";

  /** The lit fixtures and haze gain to draw this frame (`context` names what a change of passes through): `target`, or the last frame's where the change has no mark yet. */
  step(target: Held, where: Where, context: string): Held {
    const prev = this.held;
    const from = this.prevMs;
    this.prevMs = where.classMs;
    const free = prev === null || context !== this.context || where.classMs < from || where.classMs - from > JUMP_MS;
    this.context = context;
    if (free) return (this.held = target);
    const litChange = !same(prev.lit, target.lit);
    const hazeDrop = target.haze < prev.haze - HAZE_DROP;
    const marked = !(litChange || hazeDrop) || plannedMarkIn(where, from, where.classMs);
    return (this.held = marked ? target : { lit: litChange ? prev.lit : target.lit, haze: hazeDrop ? prev.haze : target.haze });
  }
}
