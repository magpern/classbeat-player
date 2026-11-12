// The shell's state: the open class, its clock and the last file error. Pure reducers; the
// shell holds the state and passes a monotonic `now`.
import { readClassText } from "./class-file.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { createClock, jump, nextInterval, pause, previousInterval, resume, start, tick } from "./clock/clock.ts";
import type { ClockState } from "./clock/clock.ts";
import { planFrom } from "./clock/plan.ts";
import type { ClockPlan } from "./clock/plan.ts";
import { viewAt } from "./clock/view.ts";
import type { ClockCommand } from "./commands.ts";
import type { FileError, Snapshot } from "./snapshot.ts";

export interface Loaded {
  readonly fileName: string;
  readonly doc: Class;
  readonly plan: ClockPlan;
  readonly clock: ClockState;
}

export interface PlayerState {
  readonly loaded: Loaded | null;
  readonly error: FileError | null;
  readonly loadId: number;
}

export const INITIAL: PlayerState = { loaded: null, error: null, loadId: 0 };

/**
 * Opens a class file's text. A valid class replaces the open one with a fresh clock; a refused
 * file leaves the open class and its clock exactly as they were (ADR 0003 section 7: the player
 * keeps playing its other classes) and records the message.
 */
export function openText(s: PlayerState, fileName: string, text: string, classSchema: unknown, now: number): PlayerState {
  const r = readClassText(text, classSchema);
  if (!r.ok) return { ...s, error: { message: r.message, details: r.details } };
  const plan = planFrom(r.doc);
  return { loaded: { fileName, doc: r.doc, plan, clock: createClock(plan.lengthMs, now) }, error: null, loadId: s.loadId + 1 };
}

/** A file that could not even be read: the open class is kept, the message recorded. */
export function refuse(s: PlayerState, message: string): PlayerState {
  return { ...s, error: { message, details: [] } };
}

function applyToClock(c: ClockState, plan: ClockPlan, cmd: ClockCommand, now: number): ClockState {
  switch (cmd.type) {
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

export function command(s: PlayerState, cmd: ClockCommand, now: number): PlayerState {
  if (s.loaded === null) return s;
  return { ...s, loaded: { ...s.loaded, clock: applyToClock(s.loaded.clock, s.loaded.plan, cmd, now) } };
}

export function advance(s: PlayerState, now: number): PlayerState {
  if (s.loaded === null) return s;
  return { ...s, loaded: { ...s.loaded, clock: tick(s.loaded.clock, now) } };
}

export function snapshotOf(s: PlayerState, now: number): Snapshot {
  const l = s.loaded;
  return {
    loadId: s.loadId,
    fileName: l?.fileName ?? null,
    doc: l?.doc ?? null,
    view: l ? viewAt(l.clock, l.plan, now) : null,
    error: s.error,
  };
}
