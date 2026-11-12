// The only D-Bus calls the shell ever makes on Linux (ADR 0001, option A: MPRIS, best effort), as
// argument lists for busctl. Pure. A caller picks a call by name from this allowlist and gets the
// same arguments every time. Following and the three commands go to the one name Spotify's own
// app owns on the session bus. The one argument that is not a constant is the bus name of another
// player, in the read-only call that asks whether it is playing (ADR 0001: "another app playing"
// is off the list); it must be a well-formed MPRIS name the bus itself listed. Every call says the
// bus must not start a service, so none of them ever starts Spotify or anything else. No call
// reads or sends audio, and none needs a Spotify token (plan section 3, rule 3).

/** systemd's own bus client, by absolute path: never looked up through PATH. */
export const BUSCTL = "/usr/bin/busctl";

/** Four readings a second (the interval target of ADR 0001 is about 1 s). */
export const LINUX_POLL_MS = 250;
/** A hung bus or Spotify must not delay coasting past 3 s: the call is killed after this. */
export const LINUX_TIMEOUT_MS = 700;
/** One line of JSON (a player's properties, or the bus's names) is expected; more is refused. */
export const LINUX_MAX_OUTPUT_BYTES = 65_536;
/** At most this many other players are asked whether they play, in one poll. */
export const MAX_OTHER_PLAYERS = 4;

/** Spotify's desktop app only: no other player's name, and never a pattern. */
export const MPRIS_NAME = "org.mpris.MediaPlayer2.spotify";
const PATH = "/org/mpris/MediaPlayer2";
const PLAYER = "org.mpris.MediaPlayer2.Player";

// The session bus; no service is started for a name nobody owns; busctl itself gives up before
// the kill; the answer is one line of JSON.
const CALL = Object.freeze(["--user", "--no-pager", "--auto-start=no", "--timeout=500ms", "--json=short", "call"] as const);
const BASE = Object.freeze([...CALL, MPRIS_NAME, PATH] as const);
const GET_ALL = Object.freeze(["org.freedesktop.DBus.Properties", "GetAll", "s", PLAYER] as const);

export const LINUX_CALLS = Object.freeze({
  /** Metadata, Position and PlaybackStatus in one answer, so they belong to one moment. */
  read: Object.freeze([...BASE, ...GET_ALL]),
  play: Object.freeze([...BASE, PLAYER, "Play"]),
  pause: Object.freeze([...BASE, PLAYER, "Pause"]),
  next: Object.freeze([...BASE, PLAYER, "Next"]),
  /** The names on the session bus, asked of the bus itself: which other players exist. */
  names: Object.freeze([...CALL, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "ListNames"]),
} as const);

/** A well-formed bus name of an MPRIS player: letters, digits, `_`, `-` and `.` only. */
const PLAYER_NAME = /^org\.mpris\.MediaPlayer2\.[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$/;

export const isOtherPlayer = (name: unknown): name is string => typeof name === "string" && PLAYER_NAME.test(name) && name !== MPRIS_NAME;

/**
 * The read call for another player, only to learn whether it is playing; null for Spotify's own
 * name and for anything that is not a well-formed player name. There is no command for another
 * player: play, pause and next exist for Spotify's name alone.
 */
export function otherPlayerArgs(name: string): readonly string[] | null {
  return isOtherPlayer(name) ? Object.freeze([...CALL, name, PATH, ...GET_ALL]) : null;
}
