// Turns busctl's JSON answer to the Linux read call (linux-calls.ts) into a reading. Pure.
// The answer is one `a{sv}` dictionary of the MPRIS player's properties, every value wrapped as
// `{"type": <D-Bus signature>, "data": <value>}`. A value is used only when its signature is the
// one MPRIS names; anything else is garbage and is never guessed at.
import { isOtherPlayer, LINUX_MAX_OUTPUT_BYTES, MAX_OTHER_PLAYERS } from "./linux-calls.ts";
import type { Observation } from "./types.ts";

export type LinuxParse =
  | { readonly kind: "reading"; readonly obs: Observation }
  /** Spotify has nothing loaded. (Spotify not running is a failed call, not an answer.) */
  | { readonly kind: "closed" }
  | { readonly kind: "garbage" };

const GARBAGE: LinuxParse = { kind: "garbage" };
const CLOSED: LinuxParse = { kind: "closed" };

/** Longer titles and artists are cut; they are only compared with the class's songs. */
export const MAX_TEXT_LENGTH = 500;
const MAX_POSITION_US = 24 * 3600 * 1_000_000;
/** MPRIS's own id for "no track". */
const NO_TRACK = "/org/mpris/MediaPlayer2/TrackList/NoTrack";

type Dict = Readonly<Record<string, unknown>>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);

/** The `data` of the wrapped value under `key`: undefined when absent, null when it is not one of `types`. */
function value(dict: Dict, key: string, types: readonly string[]): unknown {
  if (!Object.hasOwn(dict, key)) return undefined;
  const wrapped = dict[key];
  if (!isDict(wrapped) || !Object.hasOwn(wrapped, "type") || !Object.hasOwn(wrapped, "data")) return null;
  return typeof wrapped.type === "string" && types.includes(wrapped.type) ? wrapped.data : null;
}

const text = (v: unknown): string | null => (typeof v === "string" && !v.includes("\0") ? v : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** Absent is an empty text; present must be text (or, for the artists, a list of texts). */
function words(meta: Dict, key: string, list: boolean): string | null {
  const v = value(meta, key, [list ? "as" : "s"]);
  if (v === undefined) return "";
  if (!list) return text(v);
  if (!Array.isArray(v)) return null;
  const parts = v.map(text);
  return parts.every((p) => p !== null) ? parts.join(", ") : null;
}

/**
 * `at` is the monotonic time the position was read, `seenAt` the time the reader got it
 * (rule 8: a reading carries its own time).
 */
export function parseLinuxOutput(stdout: string, at: number, seenAt: number): LinuxParse {
  if (typeof stdout !== "string" || stdout.length > LINUX_MAX_OUTPUT_BYTES) return GARBAGE;
  let root: unknown;
  try {
    root = JSON.parse(stdout);
  } catch {
    return GARBAGE;
  }
  if (!isDict(root) || root.type !== "a{sv}" || !Array.isArray(root.data) || root.data.length !== 1) return GARBAGE;
  const props: unknown = root.data[0];
  if (!isDict(props)) return GARBAGE;

  const status = value(props, "PlaybackStatus", ["s"]);
  if (status === "Stopped") return CLOSED;
  if (status !== "Playing" && status !== "Paused") return GARBAGE;
  const position = count(value(props, "Position", ["x"]));
  if (position === null || position > MAX_POSITION_US) return GARBAGE;
  const meta = value(props, "Metadata", ["a{sv}"]);
  if (!isDict(meta)) return GARBAGE;
  const title = words(meta, "xesam:title", false);
  const artist = words(meta, "xesam:artist", true);
  if (title === null || artist === null) return GARBAGE;
  // The length and the id only help the match: an unreadable one is left out.
  const length = count(value(meta, "mpris:length", ["x", "t"]));
  const id = text(value(meta, "mpris:trackid", ["o", "s"]));

  return {
    kind: "reading",
    obs: {
      title: title.slice(0, MAX_TEXT_LENGTH),
      artist: artist.slice(0, MAX_TEXT_LENGTH),
      lengthMs: length !== null && length > 0 ? Math.round(length / 1000) : null,
      trackId: id === null || id === "" || id === NO_TRACK ? null : id.slice(0, MAX_TEXT_LENGTH),
      app: "Spotify",
      positionMs: Math.round(position / 1000),
      playing: status === "Playing",
      at,
      seenAt,
    },
  };
}

/** What a reading of any player but Spotify is called: a constant, never the player's own name. */
export const OTHER_PLAYER = "another player";

/** A reading of another player: it can only ever be off the list (match.ts), never followed. */
export function asOtherPlayer(obs: Observation): Observation {
  return { ...obs, app: OTHER_PLAYER, trackId: null };
}

/** The other MPRIS players in the bus's answer to the names call; none when it is unreadable. */
export function parseOtherPlayers(stdout: string): readonly string[] {
  if (typeof stdout !== "string" || stdout.length > LINUX_MAX_OUTPUT_BYTES) return [];
  let root: unknown;
  try {
    root = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!isDict(root) || root.type !== "as" || !Array.isArray(root.data) || root.data.length !== 1) return [];
  const names: unknown = root.data[0];
  return Array.isArray(names) ? names.filter(isOtherPlayer).slice(0, MAX_OTHER_PLAYERS) : [];
}
