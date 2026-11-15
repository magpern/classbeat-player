// What the screens show of the clock at one moment (ADR 0001 rules 6 and 7, manual clock).
// Pure: derived from the clock state, the plan and a monotonic time.
import { positionAt } from "./clock.ts";
import type { ClockState, Status } from "./clock.ts";
import { spanIndexAt } from "./plan.ts";
import type { ClockPlan } from "./plan.ts";

export interface ClockView {
  readonly mode: "manual";
  readonly status: Status;
  readonly classMs: number;
  readonly lengthMs: number;
  /** Rule 7 for the manual clock: no song change is measured, so time left is the class left. */
  readonly classRemainingMs: number;
  readonly intervalIndex: number;
  readonly intervalElapsedMs: number;
  readonly intervalRemainingMs: number;
  readonly nextIntervalIndex: number | null;
  /** Rule 6: at the class end the clock holds and the last interval stays on screen with its cue. */
  readonly holding: boolean;
  /** The song window class time is in, or null when the class has no usable song windows. */
  readonly songIndex: number | null;
  readonly plannedCrossfadeMs: number;
  /** Rule 7: shown beside the planned one once measured. The manual clock measures nothing. */
  readonly measuredCrossfadeMs: number | null;
}

export function viewAt(s: ClockState, plan: ClockPlan, now: number): ClockView {
  const classMs = positionAt(s, now);
  const i = spanIndexAt(plan.intervals, classMs);
  const iv = plan.intervals[i];
  const songIndex = spanIndexAt(plan.songs, classMs);
  return {
    mode: "manual",
    status: s.status,
    classMs,
    lengthMs: plan.lengthMs,
    classRemainingMs: plan.lengthMs - classMs,
    intervalIndex: i,
    intervalElapsedMs: classMs - iv.startMs,
    intervalRemainingMs: Math.max(0, iv.endMs - classMs),
    nextIntervalIndex: i + 1 < plan.intervals.length ? i + 1 : null,
    holding: s.status === "ended" || classMs >= plan.lengthMs,
    songIndex: songIndex < 0 ? null : songIndex,
    plannedCrossfadeMs: plan.plannedCrossfadeMs,
    measuredCrossfadeMs: null,
  };
}
