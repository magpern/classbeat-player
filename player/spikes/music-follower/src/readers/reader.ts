import type { Reading } from "../core/types.js";

/** One interface for every operating system. Readers only read; they never control playback. */
export interface Reader {
  readonly source: string;
  /** Pass-table rows this reader cannot observe; written to the log and the README. */
  readonly limitations?: string[];
  /** The latest reading, or null when the music app is not running or says nothing. */
  readNow(): Promise<Reading | null>;
  close?(): void;
}
