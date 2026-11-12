// The elastic last interval and the totals that follow the measurement (ADR 0001 rules 6 and 7).
// Pure arithmetic on numbers.

/**
 * While the clock holds at a window's end: the time until the next song is expected, from the
 * song's length and the crossfade measured so far (the planned one before the first change).
 * The last song has no next one: it is the time until it ends.
 */
export function holdRemainingMs(songLengthMs: number, posMs: number, crossfadeMs: number, isLast: boolean): number {
  return Math.max(0, songLengthMs - (isLast ? 0 : crossfadeMs) - posMs);
}

export interface TimeLeftInput {
  readonly lengthMs: number;
  readonly classMs: number;
  /** The song being followed, or null when none. */
  readonly songIndex: number | null;
  readonly songCount: number;
  readonly plannedCrossfadeMs: number;
  readonly measuredCrossfadeMs: number | null;
  /** The elastic countdown while holding, else null. */
  readonly holdRemainingMs: number | null;
}

/**
 * Time left: the remaining windows plus the hold expected at each remaining song change. A change
 * holds for planned minus measured crossfade (a longer real crossfade shortens the class).
 */
export function timeLeftMs(t: TimeLeftInput): number {
  const windows = t.lengthMs - t.classMs;
  if (t.songIndex === null) return Math.max(0, windows);
  const perChange = t.plannedCrossfadeMs - (t.measuredCrossfadeMs ?? t.plannedCrossfadeMs);
  const changes = Math.max(0, t.songCount - 1 - t.songIndex);
  const hold = t.holdRemainingMs === null ? changes * perChange : t.holdRemainingMs + Math.max(0, changes - 1) * perChange;
  return Math.max(0, windows + hold);
}
