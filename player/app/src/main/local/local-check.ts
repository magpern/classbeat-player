// The checks a local class asks of the music files service (service.ts `checkOpen`), kept apart
// from local-player.ts: the one before Start, repeated no sooner than RECHECK_MS, and the stop of a
// check of ours that is still running. The service runs one thing at a time, so a check left
// running keeps every later check and find waiting ("busy") until it ends.
import type { FindAnswer } from "../../core/music-files/answer.ts";
import { RECHECK_MS } from "./local-run.ts";
import type { Run } from "./local-run.ts";

export interface CheckDeps {
  /** The check for the open class's document; null while the service is busy. */
  readonly check: (doc: unknown) => Promise<FindAnswer | null>;
  /** Stops the check running (service.ts `cancel`). */
  readonly cancelCheck: () => void;
  readonly now: () => number;
}

/** The check before Start; a second one is not asked while one runs or before RECHECK_MS has passed. */
export function askCheck(d: CheckDeps, run: Run): void {
  if (run.checking || d.now() - run.checkedAt < RECHECK_MS) return;
  run.checking = true;
  run.checkedAt = d.now();
  void d.check(run.doc).then(
    (a) => {
      run.checking = false;
      if (a !== null) run.check = a;
    },
    () => {
      run.checking = false;
    },
  );
}

/**
 * A check of ours that is still running is stopped: the one before Start (a class that was replaced
 * before it answered) or the one at Start (one that timed out, or a class that was replaced). One
 * stop covers both. A check that answered or found the service busy is no longer "running", so
 * another operation's work is never stopped.
 */
export function stopRecheck(d: CheckDeps, run: Run): void {
  if (!run.rechecking && !run.checking) return;
  run.rechecking = false;
  run.checking = false;
  d.cancelCheck();
}
