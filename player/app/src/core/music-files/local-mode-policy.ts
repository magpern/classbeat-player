// Whether a class plays the instructor's own files or runs on the manual clock (ADR 0017 section
// 3; the mix's case is core/mix/mode-policy.ts). Pure. All or nothing: a class with source `local`
// plays only when every song's file was found and checked and no file's decoded length failed its
// check; one song missing is the manual clock. A Spotify, Swedebeat or soundless class never uses
// local playback. A reason names no path, folder or file from the disk.
import type { FindAnswer } from "./answer.ts";

/** The class's `music.source`. */
export type LocalModeSource = "spotify" | "swedebeat" | "none" | "local";

/**
 * Why a local class is on the manual clock. `missing`: songs whose file is not found (or whose
 * decoded length is not the song's). `not_checked`: the check before playing did not run to its
 * end. `failed`: a file failed to read or decode while the class played, or the account signed out.
 */
export type LocalFallback = { readonly reason: "missing"; readonly missing: readonly number[] } | { readonly reason: "not_checked" } | { readonly reason: "failed" };

export type LocalModeResult = { readonly mode: "local" } | ({ readonly mode: "manual" } & LocalFallback) | { readonly mode: "not_local" };

export interface LocalModeInput {
  readonly musicSource: LocalModeSource;
  /** The number of songs in the class. */
  readonly songs: number;
  /** The check before playing, or null while it has not answered. */
  readonly check: FindAnswer | null;
  /** Songs whose decoded length was confirmed more than 1 000 ms from `length_ms`. */
  readonly wrongLength: ReadonlySet<number>;
}

export function localModePolicy(i: LocalModeInput): LocalModeResult {
  if (i.musicSource !== "local") return { mode: "not_local" };
  const c = i.check;
  if (c === null || c.status !== "done" || c.songs.length !== i.songs || i.songs === 0) return { mode: "manual", reason: "not_checked" };
  const missing = c.songs.flatMap((s, k) => (s !== "found" || i.wrongLength.has(k) ? [k] : []));
  return missing.length === 0 ? { mode: "local" } : { mode: "manual", reason: "missing", missing };
}

/** The plain reason for the instructor's screen (ADR 0017 section 3): "2 music files are missing". */
export const missingWords = (n: number): string => (n === 1 ? "1 music file is missing" : `${n} music files are missing`);
