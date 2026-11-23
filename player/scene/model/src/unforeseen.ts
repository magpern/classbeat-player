// The hold after an unforeseen cause (scene.md "How a beam turns", item 1, decided in #592 and #617). A seek or a
// jump, a reload, a lost or regained lock and a resume cannot be foreseen, so the limiter keeps every beam on its
// present aim for 2 s of class-clock time and only then takes the target. The hold's inputs are the cause and the
// class clock: no interval, zone, target or run reaches it (rule 4). Pure.

import type { LinkInput } from "./beat-level.ts";
import { rigFrozen } from "./link-gate.ts";
import { MARK_GAP_MS, frameAt } from "./flash-marks.ts";
import type { PlacedRun } from "./flash-runs.ts";

/** `--scene-unforeseen-hold`: P2's longest lateness, 1 s, plus 1 s, so the scheduler sees the turn coming. */
export const UNFORESEEN_HOLD_MS = 2000;
/** The class clock moves by more than this between two frames, or backwards: a seek or a jump, a person's action (as the text layer sees it). */
export const JUMP_MS = 1000;

export type UnforeseenCause = "seek" | "jump" | "reload" | "lock lost" | "lock regained" | "resume";

const locked = (link: LinkInput): boolean => link.state === "Locked" && link.held !== true;

/**
 * A link event the scheduler did not plan: a resume (the frozen rig runs again), a lost lock or a regained one. Null on the
 * first frame. The link holding its last reading (`held`) is "no lock" (scene.md, the None level), so entering it is a lost
 * lock and leaving it a resume (the rig is frozen in it): all three are causes of "How a beam turns", item 1.
 */
export function linkCause(prev: LinkInput | null, now: LinkInput): UnforeseenCause | null {
  if (prev === null) return null;
  if (rigFrozen(prev) && !rigFrozen(now)) return "resume";
  if (locked(prev) && !locked(now)) return "lock lost";
  if (!locked(prev) && locked(now)) return "lock regained";
  return null;
}

/** A seek or a jump seen as the class clock moving by more than 1 s, or backwards, between two frames. */
export function clockCause(prevClassMs: number | null, classMs: number): UnforeseenCause | null {
  if (prevClassMs === null) return null;
  return classMs < prevClassMs || classMs - prevClassMs > JUMP_MS ? "seek" : null;
}

/** The class-clock time the hold ends after a cause on this frame; a later cause starts the 2 s again. */
export const holdEnd = (causeClassMs: number): number => causeClassMs + UNFORESEEN_HOLD_MS;

/** Whether the beams are held at this class-clock time: on the class clock, never wall time. */
export const isHeld = (holdUntilMs: number | null, classMs: number): boolean => holdUntilMs !== null && classMs < holdUntilMs;

/** A cause's mark keeps this clear of the end of a run that has ended (the 1 s gap between a sweep and a burst's decay, #615). */
export const RUN_CLEAR_MS = 1000;
/** The latest a cause's mark may be placed after the cause (C10). */
export const CAUSE_LATE_MS = 1000;
const EPS = 1e-6;

/**
 * The frame of a cause's own mark (P2, for a user action or a link event the scheduler did not plan): the first frame at
 * or after the cause that is at least 500 ms from every mark and at least 1 s after the end of every run that has ended
 * (a run in progress is cut in the frame and merged with it, `endRunsAtCauses`), and at most 1 s after the cause. Null
 * when no frame fits, which the scheduler must report, not work around. A cause whose window [cause, cause + 1 s] already
 * holds a mark of an earlier cause (`causeMarks`) takes that mark: no mark of its own, one change for both.
 */
export function causeFrame(atMs: number, frameMs: number, marks: readonly number[], runs: readonly PlacedRun[], causeMarks: readonly number[] = []): number | null {
  // A cause whose window already holds an earlier cause's mark merges into it as one change; the hold restarts from this cause.
  const merged = causeMarks.find((m) => m >= atMs - EPS && m - atMs <= CAUSE_LATE_MS + EPS);
  if (merged !== undefined) return merged;
  const ends = runs.flatMap((r) => { const to = Math.max(...r.pieces.map((p) => p.toMs)); return to <= atMs + EPS ? [to] : []; });
  let at = frameAt(atMs, frameMs);
  for (let moved = true; moved; ) {
    moved = false;
    for (const m of marks) if (Math.abs(at - m) < MARK_GAP_MS - EPS) { at = frameAt(m + MARK_GAP_MS - EPS, frameMs); moved = true; }
    for (const e of ends) if (at < e + RUN_CLEAR_MS - EPS) { at = frameAt(e + RUN_CLEAR_MS - EPS, frameMs); moved = true; }
  }
  return at - atMs <= CAUSE_LATE_MS + EPS ? at : null;
}

export interface CutRuns {
  readonly runs: PlacedRun[];
  /** The frames of the causes that cut a run: the cut lands on the cause's own frame and counts with its mark as one change. */
  readonly absorbed: readonly number[];
}

/**
 * A run in progress when a cause arrives (its time falls after the run's first piece starts and before its last piece
 * ends, a gap between a dim's pieces included) ends in the cause's frame, the frame P2 placed for it: every piece that
 * starts at or after that frame is gone, and the piece the frame falls in is cut there. The cut lands on the cause's own
 * frame and merges with the cause's mark into one counted change, as P1 merges a mark onto a frame, so the cause's
 * frame is returned in `absorbed` and its mark is not counted again. `causes` pairs each cause's time with its frame.
 */
export function endRunsAtCauses(runs: readonly PlacedRun[], causes: readonly { readonly atMs: number; readonly frameMs: number }[]): CutRuns {
  const absorbed: number[] = [];
  const ordered = [...causes].sort((a, b) => a.atMs - b.atMs);
  const cut = runs.map((run) => {
    let pieces = run.pieces;
    for (const c of ordered) {
      const from = Math.min(...pieces.map((p) => p.fromMs));
      const to = Math.max(...pieces.map((p) => p.toMs));
      if (!(from < c.atMs && c.atMs < to)) continue;
      pieces = pieces.filter((p) => p.fromMs < c.frameMs).map((p) => ({ fromMs: p.fromMs, toMs: Math.min(p.toMs, c.frameMs) }));
      absorbed.push(c.frameMs);
    }
    return { wish: run.wish, pieces };
  });
  return { runs: cut, absorbed };
}
