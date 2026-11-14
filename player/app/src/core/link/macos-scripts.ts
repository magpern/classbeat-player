// The only AppleScript the shell ever runs (ADR 0001, option A), as fixed constants. Pure.
// Nothing is ever interpolated into a script: a caller picks one by name from this allowlist and
// gets the same argument list every time. Every script first returns when Spotify is not running,
// so none of them ever starts it. No script reads or sends audio, and none needs a Spotify token
// (plan section 3, rule 3: the music stays in Spotify's own app).

/** The system's own osascript, by absolute path: never looked up through PATH. */
export const OSASCRIPT = "/usr/bin/osascript";

/** Four readings a second (the interval target of ADR 0001 is about 1 s). */
export const MAC_POLL_MS = 250;
/** A hung Spotify must not delay coasting past 3 s: the call is killed after this. */
export const MAC_TIMEOUT_MS = 700;
/**
 * Until Spotify has answered once, macOS may be showing the Automation prompt and the person may
 * take a while to click it: the first reads wait this long (then it is the normal limit above).
 */
export const MAC_FIRST_READ_MS = 10 * 60 * 1000;
/** One line of text is expected; more than this is refused. */
export const MAC_MAX_OUTPUT_BYTES = 8192;

// Variable names are long on purpose: AppleScript's own terms (st, tr, it, me, id, name, ...) can
// collide with a variable name and stop the script compiling on a real Mac (-2741, spike 1).
// Why the check and the `tell` are two statements: AppleScript has no form of `tell` that
// refuses to launch an application that is not running, so the check cannot be folded into it.
// Both sit in one script and run microseconds apart; the one way to lose the race is Spotify
// quitting in that gap, which then starts it once, and the next poll sees it running. That window
// is accepted: a `tell` with no check would start Spotify every time it is closed.
const NOT_RUNNING = 'if application "Spotify" is not running then return "notrunning"';

export const MAC_SCRIPTS = Object.freeze({
  read: Object.freeze([
    NOT_RUNNING,
    'tell application "Spotify"',
    "set playerStateText to player state as string",
    'if playerStateText is "stopped" then return "stopped"',
    "set currentTrackRef to current track",
    "return playerStateText & tab & (id of currentTrackRef) & tab & (name of currentTrackRef) & tab & (artist of currentTrackRef) & tab & (player position as string) & tab & (duration of currentTrackRef as string)",
    "end tell",
  ]),
  play: Object.freeze([NOT_RUNNING, 'tell application "Spotify" to play']),
  pause: Object.freeze([NOT_RUNNING, 'tell application "Spotify" to pause']),
  next: Object.freeze([NOT_RUNNING, 'tell application "Spotify" to next track']),
} as const);

export type MacScriptName = keyof typeof MAC_SCRIPTS;

/** The argument list for one allowlisted script; null for any other name. */
export function osascriptArgs(name: string): readonly string[] | null {
  if (!Object.hasOwn(MAC_SCRIPTS, name)) return null;
  return MAC_SCRIPTS[name as MacScriptName].flatMap((line) => ["-e", line]);
}
