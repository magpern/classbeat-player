// When the beat dot lights, kept across snapshot updates. Pure: times are passed in.
// The dot is redrawn with every snapshot, but its lights must not move with the snapshot's own
// jitter (a nudge, a resync, rounding): the schedule is kept while the beat's key (song and
// tempo in force) is the same, and a new schedule never starts a light less than 1/3 s after the
// last one (room-2d.md, "Beat dot"; system.md, Motion: nothing flashes more than three times a second).
import type { BeatModel } from "./model.ts";

/** Two lights start at least this far apart: 1/3 s, rounded up. */
export const MIN_GAP_MS = 334;

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

/**
 * The schedule for a new snapshot: the same one while the key is the same; otherwise the beat's own
 * phase, held back so the first light starts at least MIN_GAP_MS after the last one that started.
 */
export function nextSchedule(prev: BeatSchedule | null, lastStartMs: number | null, beat: BeatModel, nowMs: number): BeatSchedule {
  if (prev && prev.key === beat.key) return prev;
  const last = prev ? (lastLightStart(prev, nowMs) ?? lastStartMs) : lastStartMs;
  const desired = nowMs + beat.phaseMs;
  const earliest = last === null ? desired : last + MIN_GAP_MS;
  return { key: beat.key, periodMs: beat.periodMs, anchorMs: Math.max(desired, earliest) };
}
