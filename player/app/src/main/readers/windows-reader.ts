// The Windows reader (ADR 0001, option A): follows the Spotify desktop app through the system
// media session, by way of the fixed helper in windows-script.ts. Main process only. It holds the
// helper's latest reading and nothing else: no audio, no token, no network, and it never starts
// the music app (plan section 3, rule 3).
//
// The helper runs only while the instructor is following the music (`setActive`). If it hangs,
// dies or writes garbage, `latest` gives the old reading (which ages, rule 8) or null, and the
// supervisor replaces the helper after a growing wait.
import type { MusicReader } from "../../core/link/reader.ts";
import { isTransportAction } from "../../core/link/transport.ts";
import type { MusicTransport, TransportAction } from "../../core/link/transport.ts";
import type { Observation } from "../../core/link/types.ts";
import { createSupervisor } from "./helper-supervisor.ts";
import type { SupervisorDeps, SupervisorOptions } from "./helper-supervisor.ts";
import { MAX_LINE_LENGTH, parseWindowsLine } from "./windows-parse.ts";
import { windowsHelperDeps } from "./windows-spawn.ts";

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

/**
 * Never more than one command to the helper in this time. A command that comes sooner waits: at
 * most one, and a newer one replaces an older one (the instructor's latest intent wins).
 */
export const MIN_COMMAND_GAP_MS = 200;

export interface WindowsMusic extends MusicReader, MusicTransport {
  readonly kind: "windows";
  setActive(on: boolean): void;
}

/** Constructing the reader starts nothing: the helper starts on `setActive(true)`. */
export function createWindowsMusic(deps: SupervisorDeps = windowsHelperDeps()): WindowsMusic {
  let latest: Observation | null = null;
  let lastCommandAt = Number.NEGATIVE_INFINITY;
  let waiting: TransportAction | null = null;
  let waitTimer: unknown = null;

  const forget = (): void => {
    waiting = null;
    if (waitTimer !== null) deps.clearTimer(waitTimer);
    waitTimer = null;
  };

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
      forget();
    },
  });

  /** Writes one of the three names to the running helper; a command never starts one. */
  const sendNow = (action: TransportAction): void => {
    if (supervisor.write(`${action}\n`)) lastCommandAt = deps.now();
  };

  return {
    kind: "windows",
    latest: () => latest,
    setActive(on) {
      if (on) {
        supervisor.start();
        return;
      }
      supervisor.stop();
      latest = null;
      forget();
    },
    send(action) {
      // The name is checked again here: only one of the three literals is ever written.
      if (!isTransportAction(action) || !supervisor.running) return;
      const wait = lastCommandAt + MIN_COMMAND_GAP_MS - deps.now();
      if (wait <= 0) {
        sendNow(action);
        return;
      }
      waiting = action;
      if (waitTimer !== null) return;
      waitTimer = deps.setTimer(() => {
        waitTimer = null;
        const next = waiting;
        waiting = null;
        if (next !== null) sendNow(next);
      }, wait);
    },
  };
}
