// The live rig's share of the flash budget (scene.md "The flash budget", the scheduler's steps c to g): from what the
// class says ahead (the interval changes, the song's drops, the countdown's seconds) it builds the frame marks, asks the
// scheduler's `fitRuns` whether a run fits, and remembers the answer, so every frame sees the same one. A ramp that
// does not fit is a step in the change frame, a burst or a dim that does not fit is left out, and beat-like light is
// held at rest around every run that is placed. Pure: the class and the time come in, nothing is read.

import { HOLD_AFTER_MS, HOLD_BEFORE_MS, fixedFrames, fitRuns, inHold, patternCountRuns } from "../../model/src/index.ts";
import type { CutRecord, DarkSpan, PlacedRun, RunKind, RunWish, Span } from "../../model/src/index.ts";
import { songSpans } from "./dark-calc.ts";
import { FRAME_MS, REACH_MS, nearby, planMarks } from "./marks-calc.ts";
import type { Where } from "./marks-calc.ts";
import { readPattern } from "./pattern-light-calc.ts";
import { nth } from "./lookup.ts";

export type { Where } from "./marks-calc.ts";
const FAR_MS = 1e9;
export const RAMP_MS = 700;
export const BURST_MS = 250;
export const DIM_EDGE_MS = 120;

/** The spans where a count runs: a pattern interval whose count the level allows (a count takes every run away). */
function countSpans(w: Where): Span[] {
  const out: Span[] = [];
  w.cls.intervals.forEach((iv, i) => {
    const p = readPattern(iv.pattern);
    if (p !== null && patternCountRuns(w.level, p.startOn)) out.push({ fromMs: iv.startMs, toMs: nth(w.cls.intervals, i + 1)?.startMs ?? w.cls.endMs });
  });
  return out;
}

/** The frame a drop's burst goes up in (P1): the nearest interval change's frame when it is under 1 s away, else the drop's own, on the class clock. */
export function dropFrame(w: Where, dropClassMs: number): number {
  const { changes } = nearby(w, dropClassMs);
  return fixedFrames(changes, [dropClassMs], FRAME_MS).find((f) => f.drops.includes(dropClassMs))?.atMs ?? dropClassMs;
}

export class RunBudget {
  private readonly decided = new Map<string, boolean>();
  private placed: PlacedRun[] = [];
  private spansSeen: DarkSpan[] = [];
  private readonly cutLog: CutRecord[] = [];
  private readonly hold: { readonly before: number; readonly after: number };

  private readonly off: boolean;

  /** `hold`: `--scene-hold`, how long beat-like light is held before a run and after it. `off`: every run fits (the demo's `budget=off`, to look at a burst the scheduler would skip; never the product). */
  constructor(hold: { readonly before: number; readonly after: number } = { before: HOLD_BEFORE_MS, after: HOLD_AFTER_MS }, off = false) {
    this.hold = hold;
    this.off = off;
  }

  /** The runs placed so far: what a change the hold places for itself must count beside (S6). */
  get runs(): readonly PlacedRun[] {
    return this.placed;
  }

  /** Whether the run fits, decided once and kept: the same answer on every later frame. */
  admit(id: string, kind: RunKind, pieces: readonly Span[], w: Where, waits = false): boolean {
    if (this.off) return true;
    const known = this.decided.get(id);
    if (known !== undefined) return known;
    const at = pieces[0]?.fromMs ?? w.classMs;
    // The frame marks are the text layer's too (marks-calc.ts): one placement, for the canvas and the text.
    const { marks } = planMarks(w, at);
    const beat: Span[] = w.level === "None" ? [] : [{ fromMs: -FAR_MS, toMs: FAR_MS }];
    const wish: RunWish = { id, kind, pieces, waits };
    const song = nth(w.cls.songs, w.songIndex);
    // The dark spans, planned from the song alone (phrase flips, a build's gather, the fan's turn, the song change), the same at every level:
    // the plan is a function of the song, not of the link. Seen ones are kept: a span outlives its song.
    const [lo] = [w.classMs - REACH_MS];
    const heard = songSpans(w);
    const seen = new Set(heard.map((s) => Math.round(s.offMs)));
    const allSpans = [...heard, ...this.spansSeen.filter((s) => !seen.has(Math.round(s.offMs)))];
    this.spansSeen = allSpans.filter((s) => s.onMs > lo);
    const beatMs = song?.bpm !== undefined && song.bpm > 0 ? 60_000 / song.bpm : 500;
    const plan = fitRuns([wish], { marks, beat, count: countSpans(w), beatMs, endMs: w.classMs + 2 * REACH_MS, frameMs: FRAME_MS, placed: this.placed, sweepWindows: allSpans.map((x) => ({ fromMs: x.offMs, toMs: x.onMs })) });
    const run = plan.runs.find((r) => r.wish.id === id);
    if (run) { this.placed.push(run); this.cutLog.push(...plan.cuts); }
    this.decided.set(id, run !== undefined);
    this.placed = this.placed.filter((r) => (r.pieces.at(-1)?.toMs ?? 0) > w.classMs - 4000);
    return run !== undefined;
  }

  /** The planned sweep windows the placed bursts have cut so far: only their counted length changed, never a turn. */
  cuts(): readonly CutRecord[] {
    return this.cutLog;
  }

  /** Beat-like light is held at rest: 250 ms before a placed run starts until 300 ms after it ends. */
  held(classMs: number): boolean {
    return inHold(this.placed, classMs, this.hold.before, this.hold.after);
  }
}
