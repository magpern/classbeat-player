// The flash budget's runs (scene.md "The flash budget", the scheduler's steps c to g): a run is a change over
// more than one frame (a ramp, a burst's decay, a dim's two edges), placed into the gaps between the frame marks
// so that no mark falls inside it, no run overlaps another, and no 1 s window counts more than 3 changes, steady
// light's possible change included. Steady light is counted as one change in every 1 s window, beat or no beat: the gated
// runs show it moving a region over 10 % with the beat running (a phrase flip's sweep, a drifting haze), so it is never
// counted as 0. A sweep (the beams' turn after a phrase flip, a song change, a build's gather, a drop's fan) takes the runs away, its
// planned span (the beams move in black from the turn's first frame to the on-step, "A sweep moves in black") takes the runs away, and 1 s
// either side of it. The sweeps, the looks' sway and a burst's decay are all inside that one change: a burst counts only its rise (a mark),
// keeps every other run 1 s away, and moves a step of a span that would come near it into its own rise frame. Without the beat there is no ramp and no dim (a burst fits where the count has room); with a count running there are no runs at all. A run
// that does not fit is a step in a mark (a ramp) or is skipped (a burst, a dim). Times are milliseconds. Pure.

import { HOLD_AROUND_MS, cutSpan } from "./dark.ts";
import { SWEEP_WINDOW_MS } from "./sweeps.ts";

/** The most counted changes in any 1 s window (S6). */
export const CAP = 3;
/** Beat-like light is held at rest from this long before a run starts until this long after it ends. */
export const HOLD_BEFORE_MS = 250;
export const HOLD_AFTER_MS = 300;
const EPS = 1e-6;
/** No new run ends less than this before the turn after an unforeseen cause starts (scene.md "The flash budget"). */
const TURN_CLEAR_MS = 1000;
/** A run that waits tries the gaps after this many of the next marks, then is a step or skipped. */
const MAX_WAITS = 4;
const SECOND_MS = 1000;

/** Steady light, counted in every 1 s window with the beat or without it (scene.md, `--scene-steady-max`; measured, #590). */
export const STEADY_PER_WINDOW = 1;
/** A sweep is the beams turning at the turn limit from a known moment (a phrase flip, a song change, a build's gather, a drop's fan, a re-aim). A turn's part is at most 4.15 s (`--scene-sweep-window`); `sweeps` plans each as that long a span. */
export const SWEEP_MS = SWEEP_WINDOW_MS;

export interface Span { readonly fromMs: number; readonly toMs: number }
/** A burst's decay is a ramp inside the shared 1 of steady light, the sway and the sweeps; a burst adds its rise (a mark). */
export const isBurstKind = (kind: RunKind): boolean => kind === "lightBurst" || kind === "dropBurst";
/** The scheduler's steps: ramps (c, d), the light-only burst (e), the drop burst (f), the dim (g). */
export type RunKind = "ramp" | "lightBurst" | "dropBurst" | "dim";
/** A ramp and a dim need the beat (without it the energy is in the change frame and a song change is its re-aim); a burst only needs room in the count. */
const needsBeat = (kind: RunKind): boolean => kind === "ramp" || kind === "dim";
const ORDER: Record<RunKind, number> = { ramp: 0, lightBurst: 1, dropBurst: 2, dim: 3 };

export interface RunWish {
  readonly id: string;
  readonly kind: RunKind;
  /** Each piece is one counted change: a ramp is one, a burst's decay one (its rise is its mark), a dim two. */
  readonly pieces: readonly Span[];
  /** A run that may wait for a gap (the fan's end, a quality step); an interval change's ramp may not. */
  readonly waits?: boolean;
}
export interface Room {
  /** The frame marks, fixed frames included (every mark counts as one change, in one frame). */
  readonly marks: readonly number[];
  /** Where the beat is locked (Beat level or Tempo only); outside it there is no ramp and no dim. */
  readonly beat: readonly Span[];
  /** Where a count runs; inside it there are no runs. */
  readonly count: readonly Span[];
  readonly beatMs: number;
  readonly endMs: number;
  readonly frameMs: number;
  /** The moments (class clock, ms) a sweep starts; a run does not overlap the 4.15 s after each. */
  readonly sweeps?: readonly number[];
  /** Planned dark spans (`planSpans`: off-step to on-step, joined). A run does not overlap one or come within 1 s of its steps; a burst moves a near step into its rise frame. */
  readonly sweepWindows?: readonly PlannedWindow[];
  /** The moments (class clock, ms) the turn after an unforeseen cause starts (the cause's time plus 2 s): a sweep, and no new run ends less than 1 s before it either. */
  readonly unforeseenTurns?: readonly number[];
  /** Runs already placed, which the new ones must not touch and count beside. */
  readonly placed?: readonly PlacedRun[];
}
export interface PlacedRun { readonly wish: RunWish; readonly pieces: readonly Span[] }
/** A planned span a placed burst moved a step of: B7 (`onMs` is the burst's rise frame) or B8 (`offMs` is the rise frame, `onMs` 1 s + 1 frame after the decay, or the arrival). Only light moves. */
export interface CutRecord { readonly id: string; readonly planned: PlannedWindow; readonly kind: "b7" | "b8"; readonly offMs: number; readonly onMs: number }
/** A planned span: its off-step and on-step, and the cause that planned it where the caller knows it (`Sweep`). */
export interface PlannedWindow extends Span { readonly cause?: string }
export interface RunPlan {
  readonly runs: readonly PlacedRun[];
  /** The planned spans each placed burst moved a step of. */
  readonly cuts: readonly CutRecord[];
  /** Ramps that did not fit: a step in a mark that adds nothing. */
  readonly steps: readonly RunWish[];
  /** Bursts and dims that did not fit: left out. */
  readonly skipped: readonly RunWish[];
}

/** The most items a 1 s window overlaps (an item is a span, a mark or a steady change a point). A window that starts at an item's end, or ends at its start, does not hold it. */
export function maxInASecond(items: readonly Span[]): number {
  const sorted = [...items].sort((a, b) => a.fromMs - b.fromMs);
  const reach = SECOND_MS + Math.max(0, ...sorted.map((s) => s.toMs - s.fromMs));
  let most = 0;
  sorted.forEach((a, i) => {
    let n = 0;
    for (let j = i; j >= 0 && sorted[j]!.fromMs > a.fromMs - reach; j--) if (sorted[j]!.toMs > a.fromMs - SECOND_MS + EPS) n++;
    for (let j = i + 1; j < sorted.length && sorted[j]!.fromMs <= a.fromMs + EPS; j++) n++;
    most = Math.max(most, n);
  });
  return most;
}

const overlaps = (a: Span, b: Span): boolean => a.fromMs < b.toMs - EPS && b.fromMs < a.toMs - EPS;
const point = (t: number): Span => ({ fromMs: t, toMs: t });

/** Steps c to g: the wishes in the scheduler's order, each into a gap that holds it whole, or a step or skipped. */
export function fitRuns(wishes: readonly RunWish[], room: Room): RunPlan {
  const items: Span[] = room.marks.map(point);
  const planned: PlannedWindow[] = [...(room.sweeps ?? []).map((t) => ({ fromMs: t, toMs: t + SWEEP_MS })), ...(room.sweepWindows ?? [])];
  const unforeseen: Span[] = (room.unforeseenTurns ?? []).map((t) => ({ fromMs: t - TURN_CLEAR_MS, toMs: t + SWEEP_MS }));
  const cuts: CutRecord[] = [];
  const runs: PlacedRun[] = [...(room.placed ?? [])];
  const [steps, skipped]: [RunWish[], RunWish[]] = [[], []];
  const marks = [...room.marks].sort((a, b) => a - b);
  const near = (a: Span, b: Span): boolean => a.fromMs < b.toMs + HOLD_AROUND_MS - EPS && b.fromMs < a.toMs + HOLD_AROUND_MS - EPS;
  const held = (w: Span): Span => ({ fromMs: w.fromMs - HOLD_AROUND_MS, toMs: w.toMs + HOLD_AROUND_MS });
  const fits = (pieces: readonly Span[], kind: RunKind): boolean => {
    const beatNeeded = needsBeat(kind);
    const burst = isBurstKind(kind);
    const whole = (p: Span) => room.beat.some((b) => b.fromMs <= p.fromMs + EPS && b.toMs >= p.toMs - EPS);
    if ((beatNeeded && !pieces.every(whole)) || pieces.some((p) => room.count.some((c) => overlaps(p, c)))) return false;
    if (pieces.some((p) => marks.some((m) => m > p.fromMs + EPS && m <= p.toMs + EPS))) return false;
    if (pieces.some((p) => runs.some((r) => r.pieces.some((q) => overlaps(p, q))) || unforeseen.some((w) => overlaps(p, w)))) return false;
    // A planned span is closed to every run, and 1 s either side of its steps; a burst's decay may come near a step (the step goes into its rise frame), never inside the span.
    if (pieces.some((p) => planned.some((w) => (burst ? cutSpan({ offMs: w.fromMs, onMs: w.toMs }, p, room.frameMs).kind === "overlaps" : overlaps(p, held(w)))))) return false;
    // No other run lies within 1 s of a burst's decay, whichever was placed first (steps e and f).
    if (pieces.some((p) => runs.some((r) => (burst || isBurstKind(r.wish.kind)) && r.pieces.some((q) => near(p, q))))) return false;
    // The decay is inside the shared 1, so it is not counted beside it: the rise is a mark, already among the marks.
    const counted = runs.filter((r) => !isBurstKind(r.wish.kind)).flatMap((r) => r.pieces);
    return maxInASecond([...items, ...counted, ...(burst ? [] : pieces)]) + STEADY_PER_WINDOW <= CAP;
  };
  const shifted = (w: RunWish, by: number): Span[] => w.pieces.map((p) => ({ fromMs: p.fromMs + by, toMs: p.toMs + by }));
  for (const w of [...wishes].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (a.pieces[0]?.fromMs ?? 0) - (b.pieces[0]?.fromMs ?? 0))) {
    const start = w.pieces[0]?.fromMs ?? 0;
    const tries = [0, ...(w.waits ? marks.filter((m) => m > start).slice(0, MAX_WAITS).map((m) => m + room.frameMs - start) : [])];
    const by = tries.find((d) => fits(shifted(w, d), w.kind));
    if (by !== undefined) {
      runs.push({ wish: w, pieces: shifted(w, by) });
      if (isBurstKind(w.kind)) for (const win of planned) for (const p of shifted(w, by)) {
        const c = cutSpan({ offMs: win.fromMs, onMs: win.toMs }, p, room.frameMs);
        if (c.kind === "b7") cuts.push({ id: w.id, planned: win, kind: "b7", offMs: win.fromMs, onMs: c.onMs });
        else if (c.kind === "b8") cuts.push({ id: w.id, planned: win, kind: "b8", offMs: c.offMs, onMs: c.onMs });
      }
    } else (w.kind === "ramp" ? steps : skipped).push(w);
  }
  return { runs, cuts, steps, skipped };
}

/** The window in which beat-like light is held at rest around a run (`--scene-hold`): 250 ms before its start until 300 ms after its end. */
export function holdOf(run: PlacedRun, before = HOLD_BEFORE_MS, after = HOLD_AFTER_MS): Span {
  return { fromMs: Math.min(...run.pieces.map((p) => p.fromMs)) - before, toMs: Math.max(...run.pieces.map((p) => p.toMs)) + after };
}
export const inHold = (runs: readonly PlacedRun[], ms: number, before = HOLD_BEFORE_MS, after = HOLD_AFTER_MS): boolean => runs.some((r) => { const h = holdOf(r, before, after); return ms >= h.fromMs && ms < h.toMs; });
