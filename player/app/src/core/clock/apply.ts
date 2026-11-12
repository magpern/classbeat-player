// What a clock command does to the manual clock. Pure.
import type { ClockCommand } from "../commands.ts";
import { jump, nextInterval, pause, previousInterval, resume, start } from "./clock.ts";
import type { ClockState } from "./clock.ts";
import type { ClockPlan } from "./plan.ts";

export function applyToClock(c: ClockState, plan: ClockPlan, cmd: ClockCommand, now: number): ClockState {
  switch (cmd.type) {
    case "undo":
    case "manual":
    case "follow":
    case "pick":
      return c;
    case "start":
      return start(c, now);
    case "pause":
      return pause(c, now);
    case "resume":
      return resume(c, now);
    case "next":
      return nextInterval(c, plan, now);
    case "previous":
      return previousInterval(c, plan, now);
    case "jump":
      return jump(c, cmd.deltaMs, now);
  }
}
