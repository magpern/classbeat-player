// Checking an indexed file before it counts as found (ADR 0017 section 2, "Checking before
// playing"). Pure: the shell passes what the file system says about the path now.

import type { IndexedFile } from "./index-model.ts";

/** What the disk says about the indexed path now, not following a symbolic link; null when there is nothing there. */
export interface FileNow {
  /** A plain file (not a folder, a link, a pipe or a device). */
  readonly plain: boolean;
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * `keep`: the same plain file, size and modification time as indexed. `rehash`: a plain file of
 * the wanted size that changed its time, so it is hashed again. `drop`: gone, not a plain file, or
 * another size, so it cannot be the song's file: it leaves the index.
 */
export type CheckStep = "keep" | "rehash" | "drop";

export function checkStep(indexed: IndexedFile, wantedSize: number, now: FileNow | null): CheckStep {
  if (now === null || !now.plain || now.size !== wantedSize || indexed.size !== wantedSize) return "drop";
  return now.size === indexed.size && now.mtimeMs === indexed.mtimeMs ? "keep" : "rehash";
}
