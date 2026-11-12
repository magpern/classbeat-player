// The interface every follower of a music app implements (ADR 0001: "One interface, one module
// per follower"). The macOS reader is main/macos-reader.ts and the Windows reader
// main/readers/windows-reader.ts; the Linux reader comes in a later issue; the manual reader reads
// nothing. A reader only reports what the music app says: no method here plays, fetches, stores
// or controls anything (plan section 3, rule 3).
import type { Observation } from "./types.ts";

export interface MusicReader {
  readonly kind: "manual" | "macos" | "windows" | "linux" | "fake";
  /**
   * The latest reading, or null when the music app is closed or nothing was ever read. A reader
   * that goes quiet keeps returning the same old reading: its `seenAt` then ages (rule 8).
   */
  latest(now: number): Observation | null;
  /**
   * Only on a reader that has to ask the system for each reading: it asks only while this is on.
   * The shell turns it on when the instructor picks Follow and off again on the manual clock.
   */
  setActive?(on: boolean): void;
}

/** The manual clock's reader: no readings, ever. */
export const manualReader: MusicReader = { kind: "manual", latest: () => null };
