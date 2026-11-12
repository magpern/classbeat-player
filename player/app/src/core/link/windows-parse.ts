// Turns one line of the Windows helper's output into a reading. Pure: no I/O, no clock of its
// own (the caller passes the monotonic time the line arrived). Everything the helper writes is
// treated as untrusted text: a line is a reading only when it is exactly one of the expected
// shapes. Only the Spotify desktop app's session is ever followed; another app playing becomes a
// reading with that app's id and nothing else, which the link shows as Off the list (ADR 0001).
// Every line the helper means to write also says how many command lines it has read from its
// input so far (`commands`): that is how a written command is known to have been taken.
import type { Observation } from "./types.ts";

export type HelperLine =
  /**
   * The Spotify session, or another app playing (its `app` set, no title, never matched).
   * `between` marks what Spotify reports for a moment between two songs (reader-lifecycle.ts).
   */
  | { readonly kind: "reading"; readonly observation: Observation; readonly commands: number; readonly between?: true }
  /** The helper is well, and there is nothing it can give a current reading of. */
  | { readonly kind: "none"; readonly commands: number }
  /** A playing position whose age cannot be used: no reading; the last one is kept and ages (rule 8). */
  | { readonly kind: "undated"; readonly commands: number }
  /** Not a line the helper is meant to write. The last reading is kept and ages (rule 8). */
  | { readonly kind: "garbage" };

export const MAX_LINE_LENGTH = 8192;
const MAX_TEXT_LENGTH = 1024;
const MAX_POSITION_MS = 24 * 3_600_000;
/** A playing position this old by the system's own clock says nothing about now. */
const MAX_AGE_MS = 3_600_000;
/** More command lines than this are never read by one helper. */
const MAX_COMMANDS = 1_000_000_000;

const GARBAGE: HelperLine = { kind: "garbage" };

/** The desktop app's two session ids: the installer's and the Store package's. Nothing else. */
const SPOTIFY_IDS: readonly string[] = ["spotify.exe", "spotifyab.spotifymusic_zpdnekdrzrea0!spotify"];
export const isSpotifySession = (app: string): boolean => SPOTIFY_IDS.includes(app.toLowerCase());

/** What the Spotify session reports for a moment while it changes from one song to the next. */
const BETWEEN_SONGS: readonly string[] = ["Changing", "Stopped", "Opened"];

const text = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TEXT_LENGTH;
const ms = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_COMMANDS;
const hasOnly = (r: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(r).length === keys.length && keys.every((k) => Object.hasOwn(r, k));
const marked = (line: HelperLine, between: boolean): HelperLine => (between && line.kind === "reading" ? { ...line, between: true } : line);

/**
 * Another app is playing while Spotify is not: its id only. No title, so it matches no song.
 * `spotify` is the Spotify session's own status then ("" when there is none), never "Playing".
 */
function otherApp(r: Record<string, unknown>, app: string, commands: number, receivedAt: number): HelperLine {
  if (!hasOnly(r, ["app", "status", "spotify", "commands"]) || r.status !== "Playing" || !text(r.spotify) || r.spotify === "Playing") return GARBAGE;
  const observation: Observation = { title: "", artist: "", lengthMs: null, trackId: null, app, positionMs: 0, playing: true, at: receivedAt, seenAt: receivedAt };
  return marked({ kind: "reading", observation, commands }, BETWEEN_SONGS.includes(r.spotify));
}

/**
 * `receivedAt` is the monotonic time the line arrived. A playing position was valid when the
 * system last updated it (rule 8): the helper reports that moment and its own "now" from the same
 * system clock, so their difference is the reading's age, and `at` is moved back by it. When that
 * age cannot be used (in the future, an hour or more, or a time the app never set) the position
 * says nothing about now, and the line is undated: it gives no reading. A paused position is
 * valid as it stands.
 */
export function parseWindowsLine(line: string, receivedAt: number): HelperLine {
  if (line.length > MAX_LINE_LENGTH) return GARBAGE;
  const trimmed = line.replace(/^\uFEFF/, "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return GARBAGE;
  let j: unknown;
  try {
    j = JSON.parse(trimmed);
  } catch {
    return GARBAGE;
  }
  if (j === null || typeof j !== "object" || Array.isArray(j) || !Object.hasOwn(j, "app")) return GARBAGE;
  const r = j as Record<string, unknown>;
  if (!Object.hasOwn(r, "commands") || !count(r.commands)) return GARBAGE;
  const commands = r.commands;
  if (r.app === null) return hasOnly(r, ["app", "commands"]) ? { kind: "none", commands } : GARBAGE;
  if (!text(r.app) || r.app === "") return GARBAGE;
  if (!isSpotifySession(r.app)) return otherApp(r, r.app, commands, receivedAt);
  if (!text(r.status) || !text(r.title)) return GARBAGE;
  if (r.artist !== null && !text(r.artist)) return GARBAGE;
  if (!ms(r.positionMs) || r.positionMs < 0 || r.positionMs > MAX_POSITION_MS) return GARBAGE;
  if (!ms(r.startMs) || !ms(r.endMs) || !ms(r.lastUpdatedUtcMs) || !ms(r.nowUtcMs)) return GARBAGE;

  const playing = r.status === "Playing";
  const age = r.nowUtcMs - r.lastUpdatedUtcMs;
  if (playing && !(age >= 0 && age < MAX_AGE_MS)) return { kind: "undated", commands };
  const length = r.endMs - r.startMs;
  const observation: Observation = {
    title: r.title,
    artist: r.artist ?? "",
    lengthMs: length > 0 && length <= MAX_POSITION_MS ? length : null,
    // The system session carries no track id: matching is by title, artist and length.
    trackId: null,
    app: r.app,
    positionMs: r.positionMs,
    playing,
    at: playing ? receivedAt - age : receivedAt,
    seenAt: receivedAt,
  };
  // Between two songs: a passing status, or playing with neither a title nor an artist.
  const between = BETWEEN_SONGS.includes(r.status) || (playing && observation.title === "" && observation.artist === "");
  return marked({ kind: "reading", observation, commands }, between);
}
