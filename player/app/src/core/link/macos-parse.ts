// Turns the output of the macOS read script (macos-scripts.ts) into a reading. Pure.
// The output is one line: state, id, title, artist, position in seconds, length in ms, separated
// by tabs; or "notrunning" / "stopped". Anything else is garbage and is never guessed at.
import { readingOf, STOPPED } from "./between-songs.ts";
import { MAC_MAX_OUTPUT_BYTES } from "./macos-scripts.ts";
import type { Answer } from "./reader-lifecycle.ts";

/**
 * A reading; "closed" when Spotify is not running or has nothing loaded (stopped, which it also
 * is for a moment between two songs: marked `between`); or garbage.
 */
export type MacParse = Answer | { readonly kind: "garbage" };

const GARBAGE: MacParse = { kind: "garbage" };
const CLOSED: MacParse = { kind: "closed" };

/** Longer titles and artists are cut; they are only compared with the class's songs. */
export const MAX_TEXT_LENGTH = 500;
const MAX_POSITION_S = 24 * 3600;

/** A plain decimal number; the decimal mark may be a comma (the system's language decides). */
function number(text: string): number | null {
  if (!/^\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * `at` is the monotonic time the position was read, `seenAt` the time the reader got it
 * (rule 8: a reading carries its own time).
 */
export function parseMacOutput(stdout: string, at: number, seenAt: number): MacParse {
  if (typeof stdout !== "string" || stdout.length > MAC_MAX_OUTPUT_BYTES) return GARBAGE;
  const line = stdout.replace(/\r?\n$/, "");
  if (line === "notrunning") return CLOSED;
  if (line === "stopped") return STOPPED;
  if (/[\r\n\0]/.test(line)) return GARBAGE;
  const fields = line.split("\t");
  if (fields.length !== 6) return GARBAGE;
  const [state, id, title, artist, positionText, lengthText] = fields;
  if (state !== "playing" && state !== "paused") return GARBAGE;
  const position = number(positionText);
  if (position === null || position > MAX_POSITION_S) return GARBAGE;
  const length = number(lengthText);
  return readingOf({
    title: title.slice(0, MAX_TEXT_LENGTH),
    artist: artist.slice(0, MAX_TEXT_LENGTH),
    lengthMs: length !== null && length > 0 ? Math.round(length) : null,
    trackId: id === "" ? null : id.slice(0, MAX_TEXT_LENGTH),
    app: "Spotify",
    positionMs: Math.round(position * 1000),
    playing: state === "playing",
    at,
    seenAt,
  });
}
