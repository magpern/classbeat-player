// The scene changes only on a planned mark (scene.md "The flash budget", S6): the lit fixtures and the haze's gain are light the song's
// moments move at the moment's own time (a breakdown's end, a drop's fan ending, a build ending), and that time is not always a mark. A change
// that falls between marks waits for the next frame `planMarks` marks, if that frame is strictly less than 1 s after the change (C10); when it
// is not, the change gets a mark of its own as an unforeseen cause (`causeFrame`, P2: at least 500 ms from every mark, S6 kept, never 1 s
// late). A seek or a jump (the class clock moving backwards or by more than 1 s, as the text layer sees it), a change of `context` (the
// quality level, the stage, the link state, reduced motion) and the first frame pass through: they are marks of their own. A long frame under
// 1 s with no seek frees nothing. Light only: no angle is held here (S7, rule 4). Pure: a frame's target and its time come in.

import { CAUSE_LATE_MS, causeFrame, clockCause } from "../../model/src/index.ts";
import type { PlacedRun } from "../../model/src/index.ts";
import { FRAME_MS, planMarks } from "./marks-calc.ts";
import type { Where } from "./marks-calc.ts";

/** A haze gain that falls by more than this in a frame is a build ending (the rise is 1 % a second). */
const HAZE_DROP = 0.005;
const EPS = 1e-6;

export interface Held {
  readonly lit: readonly boolean[];
  readonly haze: number;
}
/** What to draw: `mark` is the frame of the mark the hold placed for the change (P2) on the frame it lands, else null. */
export interface Shown extends Held {
  readonly mark: number | null;
}

interface Pending {
  readonly releaseMs: number;
  /** The change has a mark of its own (P2), not one `planMarks` already had. */
  readonly placed: boolean;
}

const same = (a: readonly boolean[], b: readonly boolean[]): boolean => a.length === b.length && a.every((x, i) => x === b.at(i));

export class MarkHold {
  private held: Held | null = null;
  private prevMs: number | null = null;
  private context = "";
  private pending: Pending | null = null;
  /** Causes whose own mark would have been 1 s or more late (S6 won over P2): never expected, reported to the tests. */
  late = 0;

  /** The lit fixtures and haze gain to draw this frame (`context` names what a change of passes through; `runs` are those already placed, which a mark of its own counts beside, S6): `target`, or the last frame's where the change waits for its mark. */
  step(target: Held, where: Where, context: string, runs: readonly PlacedRun[] = []): Shown {
    const prev = this.held;
    const from = this.prevMs;
    const ms = where.classMs;
    this.prevMs = ms;
    const free = prev === null || from === null || context !== this.context || clockCause(from, ms) !== null;
    this.context = context;
    if (free) {
      this.pending = null;
      this.held = target;
      return { ...target, mark: null };
    }
    const litChange = !same(prev.lit, target.lit);
    const hazeDrop = target.haze < prev.haze - HAZE_DROP;
    if (!(litChange || hazeDrop)) {
      this.pending = null;
      this.held = target;
      return { ...target, mark: null };
    }
    if (this.pending === null) {
      const plan = planMarks(where, ms);
      const here = plan.marks.some((m) => m > from && m <= ms);
      const next = plan.marks.find((m) => m > ms);
      if (here) this.pending = { releaseMs: ms, placed: false };
      else if (next !== undefined && next < ms + CAUSE_LATE_MS - EPS) this.pending = { releaseMs: next, placed: false };
      else {
        const cause = causeFrame(ms, FRAME_MS, plan.marks, runs, [], plan.fixed.map((f) => f.atMs));
        this.late += cause.late.length;
        this.pending = { releaseMs: cause.frameMs, placed: true };
      }
    }
    const { releaseMs, placed } = this.pending;
    if (ms >= releaseMs) {
      this.pending = null;
      this.held = target;
      return { ...target, mark: placed ? releaseMs : null };
    }
    this.held = { lit: litChange ? prev.lit : target.lit, haze: hazeDrop ? prev.haze : target.haze };
    return { ...this.held, mark: null };
  }
}
