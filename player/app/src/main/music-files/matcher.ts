// Matching a class's songs to files on this device (ADR 0017 section 2). By content only: a file
// is a song's file when its size and then its SHA-256 are the song's, never by a name, tags or a
// date. First every indexed file a song wants is checked again (core/music-files/check-policy.ts):
// a changed or missing file leaves the index. Then the folders are searched for the songs still
// missing, under the shared entry limit. The index is built anew in memory; the caller decides
// whether to keep it. Paths stay inside this module and the index: nothing here logs or throws one.
import { lstat } from "node:fs/promises";
import { checkStep } from "../../core/music-files/check-policy.ts";
import type { FileNow } from "../../core/music-files/check-policy.ts";
import { MAX_ENTRIES } from "../../core/music-files/index-model.ts";
import type { IndexedFile, MusicIndex } from "../../core/music-files/index-model.ts";
import { missingOf } from "../../core/music-files/wanted.ts";
import type { WantedFile } from "../../core/music-files/wanted.ts";
import { hashFile } from "./hash-file.ts";
import { candidates } from "./walk.ts";
import type { Budget } from "./walk.ts";

export interface Matched {
  readonly index: MusicIndex;
  /** The hashes of the songs whose file was found and checked. */
  readonly found: ReadonlySet<string>;
  readonly limitReached: boolean;
}

async function fileNow(path: string): Promise<FileNow | null> {
  try {
    const st = await lstat(path);
    return { plain: st.isFile(), size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/** Checks the indexed files the songs want; a changed or missing one is dropped from `files`. */
async function recheck(wanted: readonly WantedFile[], files: Map<string, IndexedFile>, found: Set<string>, stopped: () => boolean): Promise<void> {
  for (const w of wanted) {
    if (stopped()) return;
    const indexed = files.get(w.sha256);
    if (indexed === undefined || found.has(w.sha256)) continue;
    const step = checkStep(indexed, w.size, await fileNow(indexed.path));
    if (step === "keep") {
      found.add(w.sha256);
      continue;
    }
    const again = step === "rehash" ? await hashFile(indexed.path, w.size, stopped) : null;
    if (again !== null && again.sha256 === w.sha256) {
      files.set(w.sha256, { path: indexed.path, size: w.size, mtimeMs: again.mtimeMs });
      found.add(w.sha256);
    } else if (!stopped()) files.delete(w.sha256);
  }
}

/**
 * The songs' files: the index checked again, then `folders` searched for the rest. Null when
 * `stopped()` turned true, so a cancelled find answers nothing new and keeps nothing.
 */
export async function matchFiles(wanted: readonly WantedFile[], index: MusicIndex, folders: readonly string[], maxEntries: number, stopped: () => boolean): Promise<Matched | null> {
  const files = new Map(index.files);
  const found = new Set<string>();
  await recheck(wanted, files, found, stopped);
  const budget: Budget = { left: maxEntries, reached: false };
  for (const folder of folders) {
    const missing = missingOf(wanted, found);
    if (missing.size === 0 || stopped()) break;
    if (budget.left <= 0) {
      // A folder is left unread with songs still missing.
      budget.reached = true;
      break;
    }
    const sizes = new Set(missing.values());
    for (const c of await candidates(folder, sizes, budget, stopped)) {
      if (stopped() || missing.size === 0) break;
      const got = await hashFile(c.path, c.size, stopped);
      // Only a hash a song wants with this very size counts; any other file is not looked at again.
      if (got === null || missing.get(got.sha256) !== c.size) continue;
      missing.delete(got.sha256);
      found.add(got.sha256);
      if (files.has(got.sha256) || files.size < MAX_ENTRIES) files.set(got.sha256, { path: c.path, size: c.size, mtimeMs: got.mtimeMs });
    }
  }
  if (stopped()) return null;
  return { index: { folders: index.folders, files }, found, limitReached: budget.reached };
}
