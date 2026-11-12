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
import { MAX_LINE_LENGTH, parseWindowsLine } from "../../core/link/windows-parse.ts";
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

/** A written command is answered by the second good line after it (see below). */
export const COMMAND_ANSWER_LINES = 2;

export interface WindowsMusic extends MusicReader, MusicTransport {
  readonly kind: "windows";
  setActive(on: boolean): void;
}

/** Constructing the reader starts nothing: the helper starts on `setActive(true)`. */
export function createWindowsMusic(deps: SupervisorDeps = windowsHelperDeps()): WindowsMusic {
  let latest: Observation | null = null;
  // Commands, bounded as on macOS: at most one in flight and one waiting.
  // - Nothing is written before the helper's first good line: until then it is not reading its
  //   input, and whatever was written would pile up and all run at once when it comes up.
  // - A written command is in flight until the helper has answered it: the helper reads its input
  //   once per poll, before it writes that poll's line. The first good line after a write may
  //   have been on its way already, so the second one is the answer.
  // - A command sent meanwhile waits: at most one, and a newer one replaces an older one (the
  //   instructor's latest intent wins). It is written when the one in flight is answered.
  // So a helper that is slow to start or stalls never has more than one command in its input.
  let ready = false;
  /** Good lines still to come before the written command counts as answered; 0 when none is. */
  let inFlight = 0;
  let waiting: TransportAction | null = null;

  const forget = (): void => {
    ready = false;
    inFlight = 0;
    waiting = null;
  };

  /** Writes one of the three names to the running helper; a command never starts one. */
  const sendNow = (action: TransportAction): void => {
    waiting = null;
    inFlight = supervisor.write(`${action}\n`) ? COMMAND_ANSWER_LINES : 0;
  };

  const supervisor = createSupervisor(deps, {
    ...WINDOWS_HELPER_LIMITS,
    onLine(line) {
      const parsed = parseWindowsLine(line, deps.now());
      if (parsed.kind === "garbage") return false;
      latest = parsed.kind === "reading" ? parsed.observation : null;
      ready = true;
      if (inFlight > 0) inFlight -= 1;
      if (inFlight === 0 && waiting !== null) sendNow(waiting);
      return true;
    },
    onDown() {
      latest = null;
      forget();
    },
  });

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
      if (ready && inFlight === 0) sendNow(action);
      else waiting = action;
    },
  };
}
