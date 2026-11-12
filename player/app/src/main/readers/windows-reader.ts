// The Windows reader (ADR 0001, option A): follows the Spotify desktop app through the system
// media session, by way of the fixed helper in windows-script.ts. Main process only. It holds the
// helper's latest reading and nothing else: no audio, no token, no network, and it never starts
// the music app (plan section 3, rule 3). This module holds only the helper and the parsing; when
// it runs, which reading it holds and when a command may go are the shared lifecycle's
// (core/link/reader-lifecycle.ts).
//
// The helper runs only while the instructor is following the music (`setActive`). If it hangs,
// dies or writes garbage, `latest` gives the old reading (which ages, rule 8) or null, and the
// supervisor replaces the helper after a growing wait. A helper that never runs the script,
// start after start, cannot work on this computer: the reader then stops for good
// (`unavailable`). A helper that runs the script and whose polls fail is not that: it writes the
// script's own failed line, is replaced as before, and following comes back when the fault clears.
import { createReaderLifecycle } from "../../core/link/reader-lifecycle.ts";
import type { Answer } from "../../core/link/reader-lifecycle.ts";
import type { MusicReader } from "../../core/link/reader.ts";
import type { MusicTransport } from "../../core/link/transport.ts";
import { createSupervisor } from "./helper-supervisor.ts";
import type { SupervisorDeps, SupervisorOptions } from "./helper-supervisor.ts";
import { MAX_LINE_LENGTH, parseWindowsLine } from "../../core/link/windows-parse.ts";
import type { HelperLine } from "../../core/link/windows-parse.ts";
import { windowsHelperDeps } from "./windows-spawn.ts";

/** Fixed limits of the helper (the poll interval itself is fixed in the script: 250 ms). */
export const WINDOWS_HELPER_LIMITS: Omit<SupervisorOptions, "onLine" | "onDown" | "runs"> = {
  // Starting PowerShell and loading the system types can take seconds on a cold studio computer.
  startTimeoutMs: 15_000,
  silenceTimeoutMs: 5000,
  maxGarbageLines: 8,
  maxLineLength: MAX_LINE_LENGTH,
  healthyMs: 30_000,
  minGapMs: 1000,
};

/** What the script writes when a poll failed (windows-script.ts). */
export const HELPER_FAILED_LINE = '{"error":true}';

export interface WindowsMusic extends MusicReader, MusicTransport {
  readonly kind: "windows";
  setActive(on: boolean): void;
  unavailable(): boolean;
}

const answerOf = (line: Exclude<HelperLine, { kind: "garbage" | "undated" }>): Answer =>
  line.kind === "none" ? { kind: "closed" } : { kind: "reading", obs: line.observation, between: line.between === true };

/** Constructing the reader starts nothing: the helper starts on `setActive(true)`. */
export function createWindowsMusic(deps: SupervisorDeps = windowsHelperDeps()): WindowsMusic {
  // A written command is in flight until the helper says it has read it. Every line the helper
  // writes carries the number of command lines it has read from its input so far; a command is
  // taken when that number reaches the number written to this helper. Lines the helper wrote
  // before it read the command carry a smaller number, however late they arrive, so they never
  // count as its answer. With the lifecycle's one in flight and one waiting, a helper that is
  // slow to start or stalls never has more than one unread command in its input.
  let written = 0;
  let taken: (() => void) | null = null;
  const forgetHelper = (): void => {
    written = 0;
    taken = null;
  };

  const life = createReaderLifecycle(
    { now: deps.now, giveUpMs: Number.POSITIVE_INFINITY },
    {
      start: () => supervisor.start(),
      stop() {
        supervisor.stop();
        forgetHelper();
      },
      // A command never starts a helper, and is not kept for one that is not there.
      listening: () => supervisor.running,
      /** Writes one of the three names to the running helper. */
      command(action, done) {
        if (!supervisor.write(`${action}\n`)) return done();
        written += 1;
        taken = done;
      },
    },
  );

  const supervisor = createSupervisor(deps, {
    ...WINDOWS_HELPER_LIMITS,
    onLine(line) {
      const parsed = parseWindowsLine(line, deps.now());
      // A helper cannot have read more commands than were written to it.
      if (parsed.kind === "garbage" || parsed.commands > written) return false;
      if (taken !== null && parsed.commands === written) {
        const done = taken;
        taken = null;
        done();
      }
      if (parsed.kind === "undated") life.failed(true);
      else life.answer(answerOf(parsed));
      return true;
    },
    // The script's own line for a poll that failed: no reading, but the script is running.
    runs: (line) => line.trim() === HELPER_FAILED_LINE,
    onDown(ran) {
      forgetHelper();
      life.lost(ran);
    },
  });

  return { kind: "windows", latest: life.latest, setActive: life.setActive, send: life.send, unavailable: life.unavailable };
}
