// The Windows reader (ADR 0001, option A): follows the Spotify desktop app through the system
// media session, by way of the fixed helper in windows-script.ts. Main process only. It holds the
// helper's latest reading and nothing else: no audio, no token, no network, and it never starts
// the music app (plan section 3, rule 3).
//
// The helper runs only while the instructor is following the music. If it hangs, dies or writes
// garbage, `latest` gives the old reading (which ages, rule 8) or null, and the supervisor
// replaces the helper after a growing wait.
import { isMusicAction } from "../../core/music-command.ts";
import type { MusicAction } from "../../core/music-command.ts";
import type { Observation } from "../../core/link/types.ts";
import { createSupervisor } from "./helper-supervisor.ts";
import type { SupervisorDeps, SupervisorOptions } from "./helper-supervisor.ts";
import type { ShellReader } from "./shell-reader.ts";
import { MAX_LINE_LENGTH, parseWindowsLine } from "./windows-parse.ts";

/** Fixed limits of the helper (the poll interval itself is fixed in the script: 250 ms). */
export const WINDOWS_HELPER_LIMITS: Omit<SupervisorOptions, "onLine" | "onDown"> = {
  // Starting PowerShell and loading the system types can take seconds on a cold studio computer.
  startTimeoutMs: 15_000,
  silenceTimeoutMs: 5000,
  maxGarbageLines: 8,
  maxLineLength: MAX_LINE_LENGTH,
  healthyMs: 30_000,
  minGapMs: 1000,
};

/** Never more than one command to the music app in this time; the rest are dropped. */
export const MIN_COMMAND_GAP_MS = 200;

export interface WindowsReader extends ShellReader {
  readonly kind: "windows";
  setFollowing(on: boolean): void;
  control(action: MusicAction): void;
  close(): void;
}

/** Constructing the reader starts nothing: the helper starts on `setFollowing(true)`. */
export function createWindowsReader(deps: SupervisorDeps): WindowsReader {
  let latest: Observation | null = null;
  let lastCommandAt = Number.NEGATIVE_INFINITY;

  const supervisor = createSupervisor(deps, {
    ...WINDOWS_HELPER_LIMITS,
    onLine(line) {
      const parsed = parseWindowsLine(line, deps.now());
      if (parsed.kind === "garbage") return false;
      latest = parsed.kind === "reading" ? parsed.observation : null;
      return true;
    },
    onDown() {
      latest = null;
    },
  });

  const stop = (): void => {
    supervisor.stop();
    latest = null;
  };

  return {
    kind: "windows",
    latest: () => latest,
    setFollowing(on) {
      if (on) supervisor.start();
      else stop();
    },
    control(action) {
      // The name is checked again here: only one of the three literals is ever written.
      if (!isMusicAction(action)) return;
      const now = deps.now();
      if (now - lastCommandAt < MIN_COMMAND_GAP_MS) return;
      if (supervisor.write(`${action}\n`)) lastCommandAt = now;
    },
    close: stop,
  };
}
