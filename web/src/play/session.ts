// A class on the manual clock: the clock, its plan and what a command does to them (ADR 0008,
// section 4). Pure: the monotonic time `now` comes from the caller, so every state is a function of
// its input and the unit tests drive it with numbers. The clock itself is the shared surface of the
// player lane (clock.ts, plan.ts, view.ts): this page adds nothing to how it counts.
import { createClock, JUMP_MS, jump, nextInterval, pause, previousInterval, resume, start, tick } from "../../../player/app/src/core/clock/clock.ts";
import type { ClockState, Status } from "../../../player/app/src/core/clock/clock.ts";
import { planFrom } from "../../../player/app/src/core/clock/plan.ts";
import type { ClockPlan } from "../../../player/app/src/core/clock/plan.ts";
import { viewAt } from "../../../player/app/src/core/clock/view.ts";
import type { ClockView } from "../../../player/app/src/core/clock/view.ts";
import type { Class } from "../room/input.ts";

/** What the band and the keys can ask of the clock: no undo, no follow, no change of clock. */
export type Command = "start" | "pause" | "resume" | "next" | "previous" | "forward" | "back";

export interface Session {
  readonly doc: Class;
  readonly plan: ClockPlan;
  readonly clock: ClockState;
}

/** A class opened at its start, not running. */
export function openClass(doc: Class, now: number): Session {
  const plan = planFrom(doc);
  return { doc, plan, clock: createClock(plan.lengthMs, now) };
}

/** What a command does to the clock at `now`. Moves of the starting point (before the start) keep the clock ready. */
export function apply(s: Session, cmd: Command, now: number): Session {
  const { clock, plan } = s;
  switch (cmd) {
    case "start":
      return { ...s, clock: start(clock, now) };
    case "pause":
      return { ...s, clock: pause(clock, now) };
    case "resume":
      return { ...s, clock: resume(clock, now) };
    case "next":
      return { ...s, clock: nextInterval(clock, plan, now) };
    case "previous":
      return { ...s, clock: previousInterval(clock, plan, now) };
    case "forward":
      return { ...s, clock: jump(clock, JUMP_MS, now) };
    case "back":
      return { ...s, clock: jump(clock, -JUMP_MS, now) };
  }
}

/** Time passes: a running clock that reaches the class end holds there ("Class Complete"). */
export function advance(s: Session, now: number): Session {
  return { ...s, clock: tick(s.clock, now) };
}

export const statusOf = (s: Session): Status => s.clock.status;

export const viewOf = (s: Session, now: number): ClockView => viewAt(s.clock, s.plan, now);

/** The command the main button and Space send in a state; none on "Class Complete". */
export function mainCommand(status: Status): "start" | "pause" | "resume" | null {
  return status === "ready" ? "start" : status === "running" ? "pause" : status === "paused" ? "resume" : null;
}

/** "Start" before the start, "Pause" while running, "Resume" while paused. */
export function mainWord(status: Status): "Start" | "Pause" | "Resume" {
  return status === "ready" ? "Start" : status === "paused" ? "Resume" : "Pause";
}
