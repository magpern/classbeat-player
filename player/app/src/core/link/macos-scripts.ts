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
/** One line of text is expected; more than this is refused. */
export const MAC_MAX_OUTPUT_BYTES = 8192;

const NOT_RUNNING = 'if application "Spotify" is not running then return "notrunning"';

export const MAC_SCRIPTS = Object.freeze({
  read: Object.freeze([
    NOT_RUNNING,
    'tell application "Spotify"',
    "set st to player state as string",
    'if st is "stopped" then return "stopped"',
    "set tr to current track",
    "return st & tab & (id of tr) & tab & (name of tr) & tab & (artist of tr) & tab & (player position as string) & tab & (duration of tr as string)",
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
