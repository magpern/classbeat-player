// How the link drives the class clock: only through the clock's own functions (ADR 0001, "The
// class clock runs inside the player"). Pure.
import { moveTo, pause, resume, start, tick } from "../clock/clock.ts";
import type { ClockState } from "../clock/clock.ts";

/** Put the clock at `ms`, running or paused. A clock the instructor has not started is started. */
export function setClock(c: ClockState, ms: number, running: boolean, now: number): ClockState {
  const started = c.status === "ready" ? start(c, now) : tick(c, now);
  const moved = moveTo(started, ms, now);
  return running ? resume(moved, now) : pause(moved, now);
}

/** Only change whether it runs: running keeps the place, a pause holds it. */
export function setRunning(c: ClockState, running: boolean, now: number): ClockState {
  return running ? resume(c, now) : pause(c, now);
}

/** "Runs on by itself": a clock that stood still starts again, in place. */
export function runOn(c: ClockState, now: number): ClockState {
  return c.status === "paused" ? resume(c, now) : tick(c, now);
}
