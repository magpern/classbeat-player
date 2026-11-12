// The interface every follower of a music app implements (ADR 0001: "One interface, one module
// per follower"). The macOS reader is main/macos-reader.ts, the Windows reader
// main/readers/windows-reader.ts and the Linux reader main/linux-reader.ts; the manual reader
// reads nothing. What the three share (when they run, which reading they hold, when a command may
// go) is reader-lifecycle.ts. A reader only reports what the music app says: no method here
// plays, fetches, stores or controls anything (plan section 3, rule 3).
import type { Observation } from "./types.ts";

export interface MusicReader {
  readonly kind: "manual" | "macos" | "windows" | "linux" | "fake";
  /**
   * The latest reading, or null when the music app is closed or has nothing loaded, when the
   * reader's helper was lost, or when nothing was read since following began. A reader that goes
   * quiet, or gets an answer it cannot use or cannot date, keeps returning the last good reading:
   * its `seenAt` then ages (rule 8).
   */
  latest(now: number): Observation | null;
  /**
   * Only on a reader that has to ask the system for each reading: it asks only while this is on.
   * The shell turns it on when the instructor picks Follow and off again on the manual clock.
   */
  setActive?(on: boolean): void;
  /**
   * Only on a reader that needs a helper: true once the helper has failed to start so often that
   * following cannot work on this computer. The reader has then stopped for good, and the shell
   * goes to the manual clock and no longer offers to follow.
   */
  unavailable?(): boolean;
}

/** The manual clock's reader: no readings, ever. */
export const manualReader: MusicReader = { kind: "manual", latest: () => null };
