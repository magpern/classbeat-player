// macOS: Spotify's AppleScript interface through osascript. Read-only: no play, pause or launch.
import { monoMs } from "../clock.js";
import type { PlayState, Reading } from "../core/types.js";
import { runCommand } from "./exec.js";
import type { Reader } from "./reader.js";

/** Never starts Spotify: it only asks when the app is already running. */
export const MAC_SCRIPT_LINES = [
  'if application "Spotify" is not running then return "notrunning"',
  'tell application "Spotify"',
  "set st to player state as string",
  'if st is "stopped" then return "stopped"',
  "set tr to current track",
  "return st & tab & (id of tr) & tab & (name of tr) & tab & (artist of tr) & tab & (player position as string) & tab & (duration of tr as string)",
  "end tell",
];

export function macCommand(): { file: string; args: string[] } {
  return { file: "osascript", args: MAC_SCRIPT_LINES.flatMap((l) => ["-e", l]) };
}

function toState(s: string): PlayState {
  return s === "playing" ? "playing" : s === "paused" ? "paused" : "stopped";
}

/** Parse osascript output. Position is seconds (a comma may be the decimal mark), duration ms. */
export function parseMacOutput(stdout: string, readAtMs: number, polledAtMs: number): Reading | null {
  const f = stdout.replace(/\r?\n$/, "").split("\t");
  if (f.length < 6) return null;
  const position = Number(f[4]!.replace(",", "."));
  const duration = Number(f[5]!.replace(",", "."));
  if (!Number.isFinite(position)) return null;
  return {
    trackId: f[1] || null,
    title: f[2] ?? "",
    artist: f[3] ?? "",
    positionMs: Math.round(position * 1000),
    durationMs: Number.isFinite(duration) ? Math.round(duration) : null,
    state: toState(f[0]!),
    readAtMs,
    polledAtMs,
    source: "macos-osascript",
  };
}

export class MacReader implements Reader {
  readonly source = "macos-osascript";

  async readNow(): Promise<Reading | null> {
    const { file, args } = macCommand();
    const before = monoMs();
    const out = await runCommand(file, args);
    const after = monoMs();
    if (out === null) return null;
    // The position was read somewhere inside the call: take the midpoint.
    return parseMacOutput(out, (before + after) / 2, after);
  }
}
