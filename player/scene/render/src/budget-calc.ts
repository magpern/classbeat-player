// The live rig's share of the flash budget (scene.md "The flash budget", the scheduler's steps c to g): from what the
// class says ahead (the interval changes, the song's drops, the countdown's seconds) it builds the frame marks, asks the
// scheduler's `fitRuns` whether a run fits, and remembers the answer, so every frame sees the same one. A ramp that
// does not fit is a step in the change frame, a burst or a dim that does not fit is left out, and beat-like light is
// held at rest around every run that is placed. Pure: the class and the time come in, nothing is read.

import { HOLD_AFTER_MS, HOLD_BEFORE_MS, fixedFrames, phraseFlipsMs, fitRuns, inHold, patternCountRuns } from "../../model/src/index.ts";
import type { PlacedRun, RunKind, RunWish, Span } from "../../model/src/index.ts";
import { FRAME_MS, REACH_MS, nearby, planMarks } from "./marks-calc.ts";
import type { Where } from "./marks-calc.ts";
import { readPattern } from "./pattern-light-calc.ts";
import { nth } from "./lookup.ts";

export type { Where } from "./marks-calc.ts";
const FAR_MS = 1e9;
/** The build gathers every beam over the 8 beats before a drop. */
const GATHER_BEATS = 8;
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
  private sweepsSeen: number[] = [];
  private readonly hold: { readonly before: number; readonly after: number };

  private readonly off: boolean;

  /** `hold`: `--scene-hold`, how long beat-like light is held before a run and after it. `off`: every run fits (the demo's `budget=off`, to look at a burst the scheduler would skip; never the product). */
  constructor(hold: { readonly before: number; readonly after: number } = { before: HOLD_BEFORE_MS, after: HOLD_AFTER_MS }, off = false) {
    this.hold = hold;
    this.off = off;
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
    const offset = w.classMs - w.songPosMs;
    const bpm = song?.bpm;
    // Where the beams start a sweep: a phrase flip (Beat level), a build's gather, a drop's fan. Moments are gated off the list and while frozen.
    const gather = GATHER_BEATS * (bpm !== undefined && bpm > 0 ? 60_000 / bpm : 0);
    const sweeps = [
      ...(w.level === "Beat" ? phraseFlipsMs(song?.anchors, w.songPosMs - REACH_MS, w.songPosMs + REACH_MS) : []),
      ...(song?.moments ?? []).flatMap((m) => (m.kind === "drop" ? [m.at_ms - gather, m.at_ms] : m.kind === "build" ? [m.at_ms] : [])),
    ].filter((t) => Math.abs(t - w.songPosMs) <= REACH_MS).map((t) => t + offset);
    // A sweep outlives its song: one the budget saw before a song change still counts after it.
    const allSweeps = [...new Set([...this.sweepsSeen, ...sweeps])];
    this.sweepsSeen = allSweeps.filter((t) => t > w.classMs - REACH_MS);
    // A drop's own gather and fan are not in the way of its burst: the fan's fixtures come on in the drop's frame, under it.
    const own = id.startsWith("drop@") ? Number(id.slice(5)) : Number.NaN;
    const ownAt = new Set(Number.isNaN(own) ? [] : [own - gather + offset, own + offset]);
    const heard = allSweeps.filter((t) => !ownAt.has(t));
    const beatMs = bpm !== undefined && bpm > 0 ? 60_000 / bpm : 500;
    const plan = fitRuns([wish], { marks, beat, count: countSpans(w), beatMs, endMs: w.classMs + 2 * REACH_MS, frameMs: FRAME_MS, placed: this.placed, sweeps: heard });
    const run = plan.runs.find((r) => r.wish.id === id);
    if (run) this.placed.push(run);
    this.decided.set(id, run !== undefined);
    this.placed = this.placed.filter((r) => (r.pieces.at(-1)?.toMs ?? 0) > w.classMs - 4000);
    return run !== undefined;
  }

  /** Beat-like light is held at rest: 250 ms before a placed run starts until 300 ms after it ends. */
  held(classMs: number): boolean {
    return inHold(this.placed, classMs, this.hold.before, this.hold.after);
  }
}
