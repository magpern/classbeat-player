// macOS: Spotify's AppleScript interface through osascript. Read-only: no play, pause or launch.
import { monoMs } from "../clock.js";
import type { PlayState, Reading } from "../core/types.js";
import { runCommandDetailed, type Runner } from "./exec.js";
import type { Reader } from "./reader.js";

/** A hung Spotify must not delay coasting past 3 s at 4 Hz (once macOS has let us ask). */
export const OSASCRIPT_TIMEOUT_MS = 700;
/** While macOS may still be showing the Automation prompt, wait for the person to answer. */
export const PERMISSION_WAIT_MS = 10 * 60 * 1000;

export const WAITING_NOTE = "Waiting for macOS: allow Terminal to control Spotify (click OK in the prompt, it may be behind this window).";
export const NOT_PERMITTED_NOTE =
  "macOS has not allowed this terminal to control Spotify (error -1743). Switch it on: System Settings, Privacy & Security, Automation, your terminal app, Spotify. The tool keeps running and picks it up once allowed.";

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
  readonly limitations = ["another-app-playing"]; // only the Spotify player is asked
  private permitted = false; // Spotify has answered once, so the short timeout is safe
  private notedDenied = false;
  private why: string | null = null;

  constructor(
    private readonly run: Runner = runCommandDetailed,
    private readonly note: (text: string) => void = () => {},
  ) {}

  /** Why the last read gave nothing or the music is not playing, for the status line. */
  reason(): string | null {
    return this.why;
  }

  /** One read with no short timeout, so a pending Automation prompt can be answered. */
  async prepare(): Promise<void> {
    this.note(WAITING_NOTE);
    await this.readNow();
  }

  async readNow(): Promise<Reading | null> {
    const { file, args } = macCommand();
    const before = monoMs();
    const r = await this.run(file, args, this.permitted ? OSASCRIPT_TIMEOUT_MS : PERMISSION_WAIT_MS);
    const after = monoMs();
    if (!r.ok) {
      if (/-1743|not authori[sz]ed/i.test(r.stderr)) {
        this.permitted = false;
        this.why = "not permitted by macOS (Automation)";
        if (!this.notedDenied) this.note(NOT_PERMITTED_NOTE);
        this.notedDenied = true;
      } else {
        this.why = r.timedOut ? "Spotify is not answering" : "osascript failed";
      }
      return null;
    }
    const text = r.stdout.trim();
    if (text === "notrunning") {
      this.why = "Spotify is not running";
      return null;
    }
    this.permitted = true; // Spotify answered, so macOS let us ask
    this.notedDenied = false;
    if (text === "stopped") {
      this.why = "Spotify is not playing";
      return null;
    }
    // The position was read somewhere inside the call: take the midpoint.
    const reading = parseMacOutput(r.stdout, (before + after) / 2, after);
    this.why = reading === null ? "Spotify gave an unreadable answer" : reading.state === "playing" ? null : "Spotify is paused";
    return reading;
  }
}
