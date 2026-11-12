// The manual class clock (ADR 0001, option D): start, pause, resume, skip to the next or previous
// interval, jump by 5 s. Pure and immutable: every function takes the current state and a
// monotonic time `now` in milliseconds, and returns a new state. No I/O, no timers.
//
// Rules kept here (ADR 0001, timing model):
// - Rule 4: the clock never moves backwards by itself. Time only advances from the monotonic
//   readings it is given; a reading earlier than one already seen is treated as the latest seen.
//   Class time moves backwards only by an instructor command (previous interval, jump back).
// - Rule 2 / 6 at the class end: class time never runs beyond the class length. The clock holds
//   at the end ("ended") and the last interval stays on screen with its cue.
import { spanIndexAt } from "./plan.ts";
import type { ClockPlan } from "./plan.ts";

export type Status = "ready" | "running" | "paused" | "ended";

export interface ClockState {
  readonly status: Status;
  readonly lengthMs: number;
  /** Class time at monotonic moment `anchorAt`. When not running, the class time itself. */
  readonly anchorMs: number;
  readonly anchorAt: number;
  /** The latest monotonic time this clock has seen; earlier readings never move it back. */
  readonly seenAt: number;
}

/** The jump of the nudge buttons. */
export const JUMP_MS = 5000;
/** "Previous" within this long of an interval's start goes to the interval before it. */
export const PREVIOUS_RESTART_MS = 3000;

export function createClock(lengthMs: number, now: number): ClockState {
  return { status: "ready", lengthMs, anchorMs: 0, anchorAt: now, seenAt: now };
}

const clampMs = (s: ClockState, ms: number): number => Math.min(s.lengthMs, Math.max(0, ms));
const seen = (s: ClockState, now: number): number => Math.max(s.seenAt, now);

/** Class time in ms at monotonic time `now`. */
export function positionAt(s: ClockState, now: number): number {
  if (s.status !== "running") return s.anchorMs;
  return clampMs(s, s.anchorMs + (seen(s, now) - s.anchorAt));
}

/** Advance the clock to `now`; a running clock that reaches the class end holds there. */
export function tick(s: ClockState, now: number): ClockState {
  const t = seen(s, now);
  if (s.status === "running" && positionAt(s, t) >= s.lengthMs) {
    return { ...s, status: "ended", anchorMs: s.lengthMs, anchorAt: t, seenAt: t };
  }
  return { ...s, seenAt: t };
}

function at(s: ClockState, status: Status, ms: number, now: number): ClockState {
  const t = seen(s, now);
  const pos = clampMs(s, ms);
  const ended = pos >= s.lengthMs && status !== "ready";
  return { ...s, status: ended ? "ended" : status, anchorMs: pos, anchorAt: t, seenAt: t };
}

export function start(s: ClockState, now: number): ClockState {
  if (s.status !== "ready") return tick(s, now);
  return at(s, "running", s.anchorMs, now);
}

export function pause(s: ClockState, now: number): ClockState {
  const s2 = tick(s, now);
  if (s2.status !== "running") return s2;
  return at(s2, "paused", positionAt(s2, s2.seenAt), s2.seenAt);
}

export function resume(s: ClockState, now: number): ClockState {
  const s2 = tick(s, now);
  if (s2.status !== "paused") return s2;
  return at(s2, "running", s2.anchorMs, s2.seenAt);
}

/**
 * An instructor's move to class time `ms`. A running clock keeps running, a paused or ready one
 * stays put. Moving back from the end leaves the clock paused there, for the instructor to resume.
 */
export function moveTo(s: ClockState, ms: number, now: number): ClockState {
  const s2 = tick(s, now);
  const status: Status = s2.status === "ended" ? "paused" : s2.status;
  return at(s2, status, ms, s2.seenAt);
}

/** Skip to the start of the next interval. On the last interval nothing happens. */
export function nextInterval(s: ClockState, plan: ClockPlan, now: number): ClockState {
  const s2 = tick(s, now);
  const i = spanIndexAt(plan.intervals, positionAt(s2, s2.seenAt));
  if (i < 0 || i + 1 >= plan.intervals.length || s2.status === "ended") return s2;
  return moveTo(s2, plan.intervals[i + 1].startMs, s2.seenAt);
}

/**
 * Back to the start of the current interval, or to the previous interval's start when the
 * current one began less than PREVIOUS_RESTART_MS ago (as a music player's "previous" does).
 */
export function previousInterval(s: ClockState, plan: ClockPlan, now: number): ClockState {
  const s2 = tick(s, now);
  const pos = positionAt(s2, s2.seenAt);
  const i = spanIndexAt(plan.intervals, pos);
  if (i < 0) return s2;
  const current = plan.intervals[i].startMs;
  const target = pos - current >= PREVIOUS_RESTART_MS || i === 0 ? current : plan.intervals[i - 1].startMs;
  return moveTo(s2, target, s2.seenAt);
}

/** Jump by `deltaMs` (the nudge), clamped to the class. */
export function jump(s: ClockState, deltaMs: number, now: number): ClockState {
  const s2 = tick(s, now);
  return moveTo(s2, positionAt(s2, s2.seenAt) + deltaMs, s2.seenAt);
}
