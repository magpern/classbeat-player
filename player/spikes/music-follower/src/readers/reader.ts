import type { Reading } from "../core/types.js";

/** One interface for every operating system. Readers only read; they never control playback. */
export interface Reader {
  readonly source: string;
  /** Pass-table rows this reader cannot observe; written to the log and the README. */
  readonly limitations?: string[];
  /** The latest reading, or null when the music app is not running or says nothing. */
  readNow(): Promise<Reading | null>;
  /** Before the poll loop: a one-time check that may wait on the person (macOS Automation prompt). */
  prepare?(): Promise<void>;
  /** Why the last read gave nothing, or the music is not playing; shown on the status line. */
  reason?(): string | null;
  close?(): void;
}
