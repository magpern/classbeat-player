// What `player:music-files-find` answers (ADR 0017 section 2; owner's settlement on #920). Pure.
// The answer holds, per song index, `found` or `missing`, and one boolean for the file limit.
// Nothing else: never a path, a folder name, a file name from the disk, a hash or a count of
// files read. A cancelled find and a failed find each answer only their status.
import type { WantedFile } from "./wanted.ts";

export type FileState = "found" | "missing";

export type FindAnswer =
  /** `songs[i]` is song i's file; `limit_reached` is true when the file limit left part of a folder unread. */
  | { readonly status: "done"; readonly songs: readonly FileState[]; readonly limit_reached: boolean }
  /** The folder window was closed without a choice, or the find was cancelled: nothing changed. */
  | { readonly status: "cancelled" }
  /** The find could not be done: nothing changed. No reason is given, as a reason could name the disk. */
  | { readonly status: "failed" };

/** At most this many entries of the chosen folders are read in one find or check (ADR 0017 section 2). */
export const MAX_FILES = 20_000;

export const CANCELLED: FindAnswer = Object.freeze({ status: "cancelled" });
export const FAILED: FindAnswer = Object.freeze({ status: "failed" });

/** Each song's state from the set of hashes found and checked. */
export function doneAnswer(wanted: readonly WantedFile[], found: ReadonlySet<string>, limitReached: boolean): FindAnswer {
  return { status: "done", songs: wanted.map((w) => (found.has(w.sha256) ? "found" : "missing")), limit_reached: limitReached };
}
