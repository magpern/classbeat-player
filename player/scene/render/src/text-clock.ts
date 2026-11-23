// When the text layer steps (scene.md "The flash budget", text rule 2, S14): the text shows the class as it was on the
// last frame mark and holds it until the next. The marks are `planMarks`' (marks-calc.ts), the same ones the canvas's runs
// are fitted around: the change frames (merged, P1), the countdown's seconds, the pattern count's beats and the person's
// own actions (a pause, a resume, a seek or a jump), so no two steps of either layer are less than 500 ms apart. Every
// other text (the rail's clocks, the bars line, the labels, the score's travel) shows on the first mark at or after its
// time and never before it. Pure: the frame's own state comes in, nothing is read.

import type { LinkInput, SceneClass } from "../../model/src/index.ts";
import { beatLevel } from "../../model/src/index.ts";
import type { Want } from "../../model/src/index.ts";
import { REACH_MS, planMarks } from "./marks-calc.ts";
import { nth } from "./lookup.ts";

/** What the text layer is told to show: the state of the class on the last mark's frame. */
export interface Shown {
  readonly classMs: number;
  readonly songIndex: number;
  readonly songPosMs: number;
  readonly link: LinkInput;
  readonly reducedMotion: boolean;
  /** True on the frame the text steps. */
  readonly changed: boolean;
}

export interface ClockFeed {
  readonly cls: SceneClass;
  readonly classMs: number;
  readonly songIndex: number;
  readonly songPosMs: number;
  readonly link: LinkInput;
  readonly reducedMotion: boolean;
}

/** The class clock moves by more than this between two frames: a seek or a jump, a person's action. */
const JUMP_MS = 1000;
/** The plan is made again once the clock is this far from where it was made (the marks it holds reach 6 s each way). */
const REPLAN_MS = 2500;
const EPS = 1e-6;

const stateKey = (f: ClockFeed): string => `${f.link.state}|${f.link.held === true}|${f.reducedMotion}`;

export class TextClock {
  private prev: { readonly cls: SceneClass; readonly classMs: number; readonly key: string } | null = null;
  private plan: { readonly at: number; readonly marks: readonly number[] } | null = null;
  private actions: Want[] = [];
  /** The marks already shown, which the others keep 500 ms from. */
  private fired: number[] = [];
  private lastMark = Number.NEGATIVE_INFINITY;
  private out: Shown | null = null;
  private seen: ClockFeed | null = null;

  /** A mark the rig placed for itself (P2, mark-hold-calc.ts): the text's own marks keep 500 ms from it. */
  note(markMs: number): void {
    if (!this.fired.includes(markMs)) this.fired = [...this.fired, markMs];
    this.plan = null;
  }

  /** The text for this frame. The same feed again (the host asks first, the rig's loop after) gives the same answer. */
  step(feed: ClockFeed): Shown {
    const s = this.seen;
    if (this.out !== null && s !== null && s.cls === feed.cls && s.classMs === feed.classMs && s.songIndex === feed.songIndex && s.songPosMs === feed.songPosMs && s.link === feed.link && s.reducedMotion === feed.reducedMotion) return this.out;
    this.seen = feed;
    const c = feed.classMs;
    const prev = this.prev;
    const jump = prev === null || prev.cls !== feed.cls || Math.abs(c - prev.classMs) > JUMP_MS || c < prev.classMs;
    if (prev === null) {
      this.lastMark = c;
    } else if (jump) {
      // A seek or a jump: every mark planned for the old time is void, and the new time is an action's frame.
      this.actions = [{ kind: "action", atMs: c }];
      this.fired = [];
      this.plan = null;
      this.lastMark = c - 1e-3;
    } else if (prev.key !== stateKey(feed)) {
      this.actions = [...this.actions, { kind: "action", atMs: c }];
      this.plan = null;
    }
    this.prev = { cls: feed.cls, classMs: c, key: stateKey(feed) };

    if (prev !== null) {
      if (this.plan === null || Math.abs(c - this.plan.at) > REPLAN_MS) {
        const level = beatLevel(feed.link, nth(feed.cls.songs, feed.songIndex) ?? null);
        const where = { cls: feed.cls, classMs: c, songIndex: feed.songIndex, songPosMs: feed.songPosMs, level };
        const made = planMarks(where, c, REACH_MS, { actions: this.actions, shown: this.fired });
        this.plan = { at: c, marks: made.marks };
      }
    }
    const due = prev === null ? c : this.plan?.marks.filter((m) => m > this.lastMark + EPS && m <= c + EPS).at(-1);
    const changed = due !== undefined;
    if (changed) {
      this.lastMark = due;
      this.fired = [...this.fired.filter((m) => m > due - 2 * REACH_MS), due];
      // What is shown is this frame's state, so every action up to now is shown; the marks planned for them are void.
      if (this.actions.length > 0) { this.actions = []; this.plan = null; }
      this.out = { classMs: c, songIndex: feed.songIndex, songPosMs: feed.songPosMs, link: feed.link, reducedMotion: feed.reducedMotion, changed: true };
    } else if (this.out !== null) {
      this.out = { ...this.out, changed: false };
    }
    if (this.out === null) throw new RangeError("the text clock has nothing to show");
    return this.out;
  }
}
