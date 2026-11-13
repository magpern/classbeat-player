// When the beat dot lights, kept across snapshot updates. Pure: times are passed in.
// The dot is redrawn with every snapshot, but its lights must not move with the snapshot's own
// jitter (rounding, a nudge): the schedule runs at the exact beat period and is kept while the
// snapshot's phase agrees with it within PHASE_TOLERANCE_MS. A larger disagreement (a seek or a
// replayed chorus inside the song, a resync, drift) or a new key (song and tempo in force) re-phases
// it, and a new schedule never starts a light less than 1/3 s after the last one (room-2d.md,
// "Beat dot"; system.md, Motion: nothing flashes more than three times a second).
import type { BeatModel } from "./model.ts";

/** Two lights start at least this far apart: 1/3 s. */
export const MIN_GAP_MS = 1000 / 3;
/** A snapshot whose phase is within this of the schedule's does not move it. */
export const PHASE_TOLERANCE_MS = 60;

export interface BeatSchedule {
  readonly key: string;
  readonly periodMs: number;
  /** When a light starts; later ones follow every period. May be in the future. */
  readonly anchorMs: number;
}

/** The start of the most recent light at `nowMs`, or null if the first is still to come. */
export function lastLightStart(s: BeatSchedule, nowMs: number): number | null {
  if (nowMs < s.anchorMs) return null;
  return s.anchorMs + Math.floor((nowMs - s.anchorMs) / s.periodMs) * s.periodMs;
}

/** How far the schedule's next light is from the snapshot's, in (-period/2, period/2]. */
function phaseError(s: BeatSchedule, desiredMs: number): number {
  const d = (desiredMs - s.anchorMs) % s.periodMs;
  const wrapped = d < 0 ? d + s.periodMs : d;
  return wrapped > s.periodMs / 2 ? wrapped - s.periodMs : wrapped;
}

/**
 * The schedule for a new snapshot: the same one while the key is the same and the phase agrees;
 * otherwise the beat's own phase, held back so the first light starts at least MIN_GAP_MS after
 * the last one that started.
 */
export function nextSchedule(prev: BeatSchedule | null, lastStartMs: number | null, beat: BeatModel, nowMs: number): BeatSchedule {
  const desired = nowMs + beat.phaseMs;
  if (prev && prev.key === beat.key && prev.periodMs === beat.periodMs && Math.abs(phaseError(prev, desired)) <= PHASE_TOLERANCE_MS) return prev;
  const last = prev ? (lastLightStart(prev, nowMs) ?? lastStartMs) : lastStartMs;
  const earliest = last === null ? desired : last + MIN_GAP_MS;
  return { key: beat.key, periodMs: beat.periodMs, anchorMs: Math.max(desired, earliest) };
}
