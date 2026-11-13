// The countdowns between two state messages (ADR 0005 sections 1 and 6; docs/design/companion.md,
// "Built on the contract"). Pure: no DOM, no I/O. The phone counts down from the last state with
// its own monotonic clock, and only while `status` is `running`:
// - live for at most 3 s past the last state while connected;
// - after that, and while reconnecting or while the computer is away, "not live" (dimmed,
//   dashed) and still running on, until 10 s after the last state;
// - then "lost": no countdown at all, only the last zone seen.
import { LIVE_FOR_MS, NOT_LIVE_FOR_MS, isLive } from "./session.ts";
import type { Live } from "./session.ts";
import type { CompanionState } from "./state-check.ts";

export type Liveness = "live" | "not_live" | "lost";

export function liveness(l: Live, at: number): Liveness {
  if (isLive(l, at)) return "live";
  return l.state && at - l.stateAt <= NOT_LIVE_FOR_MS ? "not_live" : "lost";
}

export interface Counts {
  /** Time left in the interval now. */
  readonly remainingMs: number;
  readonly classRemainingMs: number;
  /** Time to the next song change, or null when there is none. */
  readonly toSongMs: number | null;
  /** Class time now. */
  readonly classMs: number;
}

/** How far the class has run since the state arrived, as far as the phone may assume. */
export function runSince(s: CompanionState, stateAt: number, at: number): number {
  if (s.status !== "running") return 0;
  return Math.min(Math.max(0, at - stateAt), NOT_LIVE_FOR_MS);
}

/** The state's numbers moved on by the time run since it arrived. None goes under zero. */
export function countsAt(s: CompanionState, stateAt: number, at: number): Counts {
  const run = runSince(s, stateAt, at);
  const classMs = Math.min(s.classMs + run, s.lengthMs);
  return {
    remainingMs: Math.max(0, s.now.remainingMs - run),
    classRemainingMs: Math.max(0, s.classRemainingMs - run),
    toSongMs: s.nextSong ? Math.max(0, s.nextSong.atMs - s.classMs - run) : null,
    classMs,
  };
}

/** How long ago the last state came, for "Last seen 0:12 ago". */
export const lastSeenMs = (l: Live, at: number): number => Math.max(0, at - l.stateAt);

export { LIVE_FOR_MS, NOT_LIVE_FOR_MS };
