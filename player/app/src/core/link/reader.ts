// The interface every follower of a music app implements (ADR 0001: "One interface, one module
// per follower"). The macOS, Windows and Linux readers come in later issues; the manual reader
// reads nothing. A reader only reports what the music app says: no method here plays, fetches,
// stores or controls anything (plan section 3, rule 3).
import type { Observation } from "./types.ts";

export interface MusicReader {
  readonly kind: "manual" | "macos" | "windows" | "linux" | "fake";
  /**
   * The latest reading, or null when the music app is closed or nothing was ever read. A reader
   * that goes quiet keeps returning the same old reading: its `seenAt` then ages (rule 8).
   */
  latest(now: number): Observation | null;
}

/** The manual clock's reader: no readings, ever. */
export const manualReader: MusicReader = { kind: "manual", latest: () => null };
