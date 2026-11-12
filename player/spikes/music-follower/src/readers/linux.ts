// Linux: MPRIS through playerctl (a D-Bus client), best effort. Read-only.
import { monoMs } from "../clock.js";
import type { PlayState, Reading } from "../core/types.js";
import { runCommand } from "./exec.js";
import type { Reader } from "./reader.js";

const FORMAT = "{{status}}\t{{mpris:trackid}}\t{{title}}\t{{artist}}\t{{position}}\t{{mpris:length}}";

export function linuxCommand(): { file: string; args: string[] } {
  return { file: "playerctl", args: ["-p", "spotify", "metadata", "--format", FORMAT] };
}

function toState(s: string): PlayState {
  const v = s.toLowerCase();
  return v === "playing" ? "playing" : v === "paused" ? "paused" : "stopped";
}

/** Parse playerctl output. Position and length are in microseconds. */
export function parseLinuxOutput(stdout: string, readAtMs: number, polledAtMs: number): Reading | null {
  const f = stdout.replace(/\r?\n$/, "").split("\t");
  if (f.length < 6) return null;
  const position = Number(f[4]);
  const length = Number(f[5]);
  if (!Number.isFinite(position)) return null;
  return {
    trackId: f[1] || null,
    title: f[2] ?? "",
    artist: f[3] ?? "",
    positionMs: Math.round(position / 1000),
    durationMs: Number.isFinite(length) && length > 0 ? Math.round(length / 1000) : null,
    state: toState(f[0]!),
    readAtMs,
    polledAtMs,
    source: "linux-playerctl",
  };
}

export class LinuxReader implements Reader {
  readonly source = "linux-playerctl";

  async readNow(): Promise<Reading | null> {
    const { file, args } = linuxCommand();
    const before = monoMs();
    const out = await runCommand(file, args);
    const after = monoMs();
    return out === null ? null : parseLinuxOutput(out, (before + after) / 2, after);
  }
}
