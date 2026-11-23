// Where the band's, the join sheet's and the plate's visible changes fall in time (room-2d.md, "Motion and
// reduced motion: the flash budget on the plain screen (S6)"; scene.md, "The flash budget", P2). Each one is a
// step in a frame of its own: the earliest frame at or after its time that is at least 500 ms from every mark
// already shown. The scheduler is the scene model's, imported as it is; this module only keeps the marks shown.
// Pure: no clock, no timers, no page. The times are milliseconds on one clock (the page's `performance.now()`).
import { MARK_GAP_MS, placeMarks } from "../../../../scene/model/src/flash-marks.ts";

/** The grid a frame is a multiple of. The page cannot see its own frames, so a millisecond stands for one. */
export const FRAME_MS = 1;

export interface Ledger {
  /** The marks put on screen lately, in time order. */
  readonly shown: readonly number[];
}

export const NO_MARKS: Ledger = { shown: [] };

/** The frame a change wanted at `atMs` falls in: its own time when it is free, else the earliest one 500 ms clear. */
export function placeChange(l: Ledger, atMs: number): number {
  const placed = placeMarks([], [{ kind: "action", atMs }], FRAME_MS, l.shown)[0]!;
  return placed.atMs ?? atMs;
}

/** A mark was put on screen at `atMs`; marks too old to matter any more are forgotten. */
export function recordMark(l: Ledger, atMs: number): Ledger {
  return { shown: [...l.shown.filter((m) => m > atMs - 2 * MARK_GAP_MS), atMs].sort((a, b) => a - b) };
}
