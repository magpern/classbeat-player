// Windows: Global System Media Transport Controls session for Spotify, through one long-lived
// PowerShell process that prints a JSON line per tick (starting PowerShell per poll is too slow).
import { spawn, type ChildProcess } from "node:child_process";
import { monoMs } from "../clock.js";
import type { PlayState, Reading } from "../core/types.js";
import type { Reader } from "./reader.js";
import { windowsScript } from "./windows_script.js";

export function windowsCommand(intervalMs: number): { file: string; args: string[] } {
  const encoded = Buffer.from(windowsScript(intervalMs), "utf16le").toString("base64");
  return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded] };
}

function toState(s: string): PlayState {
  return s === "Playing" ? "playing" : s === "Paused" ? "paused" : "stopped";
}

/**
 * Parse one line of the script. `receivedMonoMs` is when we got the line. A playing position is
 * valid at LastUpdatedTime, so `readAtMs` is moved back by the age the system itself reports
 * (both timestamps come from the same Windows clock). A paused position is valid now.
 */
export function parseWindowsLine(line: string, receivedMonoMs: number): Reading | null {
  const text = line.replace(/^\uFEFF/, "").trim();
  if (!text.startsWith("{")) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const position = Number(j["positionMs"]);
  if (!Number.isFinite(position)) return null;
  const state = toState(String(j["status"]));
  const age = Number(j["nowUtcMs"]) - Number(j["lastUpdatedUtcMs"]);
  const usable = state === "playing" && Number.isFinite(age) && age >= 0 && age < 3_600_000;
  const duration = Number(j["endMs"]) - Number(j["startMs"]);
  return {
    trackId: null, // the system session carries no track id: matching is by title, artist and length
    title: String(j["title"] ?? ""),
    artist: String(j["artist"] ?? ""),
    positionMs: position,
    durationMs: Number.isFinite(duration) && duration > 0 ? duration : null,
    state,
    readAtMs: usable ? receivedMonoMs - age : receivedMonoMs,
    polledAtMs: receivedMonoMs,
    source: "windows-gsmtc",
    app: typeof j["app"] === "string" ? j["app"] : null,
  };
}

export class WindowsReader implements Reader {
  readonly source = "windows-gsmtc";
  private child: ChildProcess;
  private latest: Reading | null = null;
  private buffer = "";

  constructor(intervalMs: number) {
    const { file, args } = windowsCommand(intervalMs);
    this.child = spawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => this.onData(chunk));
    this.child.on("exit", () => {
      this.latest = null;
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 1);
      this.latest = parseWindowsLine(line, monoMs());
    }
  }

  async readNow(): Promise<Reading | null> {
    return this.latest;
  }

  close(): void {
    this.child.kill();
  }
}
