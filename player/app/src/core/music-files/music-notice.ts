// What the instructor's presenter window says when a class whose music is the instructor's own files
// is on the manual clock (docs/design/music-files.md, "Presenter window, during a class"): the
// music line, the song that failed and, for a failure in the middle of the class, a plate that says
// it once. Pure. The words name only the class document's own song title (neutralised); never a
// path, a folder, a file name from the disk or a reason from it. The room screen never gets this:
// its link line is the existing grey "Manual clock" (room-2d.md).
import type { LocalFallback } from "./local-mode-policy.ts";
import { safeText } from "./safe-text.ts";

/** Why the audio stopped in the middle of the class. `read`: a file could not be read or decoded; `length`: its decoded length was wrong twice; `signed_out`: the account signed out. */
export interface LocalStop {
  /** The song that failed, or null when none is to blame (a sign-out). */
  readonly song: number | null;
  readonly why: "read" | "length" | "signed_out";
}

export interface MusicNotice {
  /** "Manual clock, music stopped" after a failure, "Manual clock" when the class started on it. */
  readonly line: string;
  /** The grey line under it: the song that failed, or how many files were missing at the start. */
  readonly detail: string | null;
  /** The plate for a failure mid-class; null for a choice made before the start. */
  readonly plate: { readonly headline: string; readonly body: string } | null;
}

const KEEPS_RUNNING = "The clock keeps running.";

/**
 * The notice for a local class on the manual clock; null while it plays or has not started, and
 * for every other class. `title` is the failed song's title in the class document, or null.
 */
export function musicNoticeOf(fallback: LocalFallback | null, stop: LocalStop | null, title: string | null): MusicNotice | null {
  if (fallback === null) return null;
  if (fallback.reason === "missing") {
    const n = fallback.missing.length;
    return { line: "Manual clock", detail: `${n} music ${n === 1 ? "file was" : "files were"} missing when the class started`, plate: null };
  }
  if (fallback.reason === "not_checked") return { line: "Manual clock", detail: "The music files could not be checked when the class started", plate: null };
  const name = title === null ? null : safeText(title);
  const line = "Manual clock, music stopped";
  const headline = "The music stopped";
  if (name === null || stop === null || stop.why === "signed_out") return { line, detail: null, plate: { headline, body: KEEPS_RUNNING } };
  return stop.why === "length"
    ? { line, detail: `${name} is the wrong length`, plate: { headline, body: `${name} is the wrong length. ${KEEPS_RUNNING}` } }
    : { line, detail: `${name} could not be played`, plate: { headline, body: `${name} could not be read. ${KEEPS_RUNNING}` } };
}
