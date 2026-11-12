// Turns one line of the Windows helper's output into a reading. Pure: no I/O, no clock of its
// own (the caller passes the monotonic time the line arrived). Everything the helper writes is
// treated as untrusted text: a line is a reading only when it is exactly the expected shape, and
// only for the Spotify desktop app's session. Another app's session is never a reading.
import type { Observation } from "../../core/link/types.ts";

export type HelperLine =
  /** The Spotify session, as a reading. */
  | { readonly kind: "reading"; readonly observation: Observation }
  /** The helper is well, and there is no Spotify session to read. */
  | { readonly kind: "none" }
  /** Not a line the helper is meant to write. The last reading is kept and ages (rule 8). */
  | { readonly kind: "garbage" };

export const MAX_LINE_LENGTH = 8192;
const MAX_TEXT_LENGTH = 1024;
const MAX_POSITION_MS = 24 * 3_600_000;
/** A position older than this by the system's own clock is not extrapolated from. */
const MAX_AGE_MS = 3_600_000;

const GARBAGE: HelperLine = { kind: "garbage" };
const NONE: HelperLine = { kind: "none" };

/** The desktop app's session id: "Spotify.exe", or the Store package "SpotifyAB.SpotifyMusic_…". */
export const isSpotifySession = (app: string): boolean => /^spotify/i.test(app);

const text = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TEXT_LENGTH;
const ms = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * `receivedAt` is the monotonic time the line arrived. A playing position was valid when the
 * system last updated it (rule 8): the helper reports that moment and its own "now" from the same
 * system clock, so their difference is the reading's age, and `at` is moved back by it. A paused
 * position is valid as it stands.
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
  if (j === null || typeof j !== "object" || Array.isArray(j) || !("app" in j)) return GARBAGE;
  const r = j as Record<string, unknown>;
  if (r.app === null) return Object.keys(r).length === 1 ? NONE : GARBAGE;
  if (!text(r.app) || r.app === "") return GARBAGE;
  // Another app's session is not ours to read: it is as if there were no Spotify session.
  if (!isSpotifySession(r.app)) return NONE;
  if (!text(r.status) || !text(r.title)) return GARBAGE;
  if (r.artist !== null && !text(r.artist)) return GARBAGE;
  if (!ms(r.positionMs) || r.positionMs < 0 || r.positionMs > MAX_POSITION_MS) return GARBAGE;
  if (!ms(r.startMs) || !ms(r.endMs) || !ms(r.lastUpdatedUtcMs) || !ms(r.nowUtcMs)) return GARBAGE;

  const playing = r.status === "Playing";
  const age = r.nowUtcMs - r.lastUpdatedUtcMs;
  const aged = playing && age >= 0 && age < MAX_AGE_MS;
  const length = r.endMs - r.startMs;
  return {
    kind: "reading",
    observation: {
      title: r.title,
      artist: r.artist ?? "",
      lengthMs: length > 0 && length <= MAX_POSITION_MS ? length : null,
      // The system session carries no track id: matching is by title, artist and length.
      trackId: null,
      app: r.app,
      positionMs: r.positionMs,
      playing,
      at: aged ? receivedAt - age : receivedAt,
      seenAt: receivedAt,
    },
  };
}
