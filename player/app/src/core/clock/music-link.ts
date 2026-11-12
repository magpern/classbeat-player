// The interface the class clock will take music readings from (ADR 0001, "Music link: follow,
// never depend"). The followers (macOS, Windows, Linux) come in PL5; the manual clock reads
// nothing. Pure: types and rules only. A follower only reads what the music app reports: no
// interface here plays, fetches or stores audio (plan section 3, rule 3).

/** One reading of what the music app is playing. */
export interface MusicReading {
  /** Index of the class song this was matched to, or null when off the list. */
  readonly songIndex: number | null;
  /** Position inside that song, in ms from the song's own start. */
  readonly positionMs: number;
  readonly playing: boolean;
  /**
   * Monotonic time (ms, same clock as the class clock) when the system last updated this
   * position. Rule 8: positions carry their own time.
   */
  readonly at: number;
}

export interface MusicLink {
  readonly kind: "manual" | "fake";
  /** The latest reading, or null when there is none. */
  latest(): MusicReading | null;
}

/** Readings older than this are stale (ADR 0001: coasting is entered within 3 s). */
export const STALE_AFTER_MS = 3000;

/** Rule 8: a stale reading is never treated as current. A reading from the future is not fresh either. */
export function isFresh(r: Pick<MusicReading, "at">, now: number, staleAfterMs = STALE_AFTER_MS): boolean {
  const age = now - r.at;
  return age >= 0 && age <= staleAfterMs;
}

/** Rule 8: the position extrapolated from the moment the system last updated it. */
export function positionNow(r: Pick<MusicReading, "positionMs" | "playing" | "at">, now: number): number {
  return r.playing ? r.positionMs + Math.max(0, now - r.at) : r.positionMs;
}

/** The manual clock's link: no readings, ever. */
export const manualLink: MusicLink = { kind: "manual", latest: () => null };
