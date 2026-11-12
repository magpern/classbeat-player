// Shared data shapes. Pure: no imports with side effects.

export type PlayState = "playing" | "paused" | "stopped";

/** One reading of the music app. Times are monotonic milliseconds on the follower's own clock. */
export interface Reading {
  trackId: string | null;
  title: string;
  artist: string;
  /** Position of playback at `readAtMs` (not at `polledAtMs`). */
  positionMs: number;
  durationMs?: number | null;
  state: PlayState;
  /** The moment `positionMs` was true (Windows gives this explicitly). */
  readAtMs: number;
  /** The moment this information reached us; used to judge staleness. */
  polledAtMs: number;
  source: string;
  /** The media app the reading came from, when the system says (Windows). */
  app?: string | null;
}

/** Link states of plan section 4. */
export type LinkState =
  | "Locked"
  | "Paused"
  | "Coasting"
  | "Off the list"
  | "Ambiguous"
  | "Manual";

export interface Decision {
  nowMs: number;
  state: LinkState;
  classTimeMs: number;
  running: boolean;
  songIndex: number | null;
  candidates: number[];
  /** song_change, seek, relock, locked, coasting, off_list, pause, resume, undo, ... or null. */
  event: string | null;
  /** New clock minus where the clock would have been by itself. */
  deltaMs: number | null;
  /** True while the music plays past the end of its window and the clock holds. */
  held: boolean;
  /** Text for the instructor's screen when a correction exceeds the announce threshold. */
  announce: string | null;
  readingAgeMs: number | null;
}
