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
import { goManual, pickOccurrence, relink, undo } from "./link/commands.ts";
import type { CommandResult } from "./link/commands.ts";
import { step } from "./link/follower.ts";
import { linkPlanFrom } from "./link/plan.ts";
import { initialLink } from "./link/types.ts";
import type { LinkModel, LinkPlan, Observation } from "./link/types.ts";
import { linkViewAt } from "./link/view.ts";
import type { FileError, Snapshot } from "./snapshot.ts";

export interface Loaded {
  readonly fileName: string;
  readonly doc: Class;
  readonly plan: ClockPlan;
  readonly clock: ClockState;
  readonly linkPlan: LinkPlan;
  readonly link: LinkModel;
  /** False when no music reader exists: the clock is manual only. */
  readonly following: boolean;
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
export function openText(s: PlayerState, fileName: string, text: string, classSchema: unknown, now: number, following = false): PlayerState {
  const r = readClassText(text, classSchema);
  if (!r.ok) return { ...s, error: { message: r.message, details: r.details } };
  const plan = planFrom(r.doc);
  const linkPlan = linkPlanFrom(r.doc);
  const link = initialLink(following && !linkPlan.manualOnly);
  const loaded: Loaded = { fileName, doc: r.doc, plan, clock: createClock(plan.lengthMs, now), linkPlan, link, following };
  return { loaded, error: null, loadId: s.loadId + 1 };
}

/** A file that could not even be read: the open class is kept, the message recorded. */
export function refuse(s: PlayerState, message: string): PlayerState {
  return { ...s, error: { message, details: [] } };
}

function applyToClock(c: ClockState, plan: ClockPlan, cmd: ClockCommand, now: number): ClockState {
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

function applyToLink(l: Loaded, cmd: ClockCommand, now: number): CommandResult | null {
  switch (cmd.type) {
    case "undo":
      return undo(l.link, l.clock, now);
    case "manual":
      return goManual(l.link, l.clock);
    case "follow":
      return relink(l.link, l.clock, l.following && !l.linkPlan.manualOnly);
    case "pick":
      return pickOccurrence(l.link, l.clock, cmd.songIndex);
    default:
      return null;
  }
}

export function command(s: PlayerState, cmd: ClockCommand, now: number): PlayerState {
  const l = s.loaded;
  if (l === null) return s;
  const viaLink = applyToLink(l, cmd, now);
  if (viaLink) return { ...s, loaded: { ...l, link: viaLink.link, clock: viaLink.clock } };
  return { ...s, loaded: { ...l, clock: applyToClock(l.clock, l.plan, cmd, now) } };
}

/** One tick: follow the music (when there is a reader) and advance the clock. */
export function advance(s: PlayerState, now: number, obs: Observation | null = null): PlayerState {
  const l = s.loaded;
  if (l === null) return s;
  const r = step(l.link, l.clock, l.linkPlan, obs, now);
  return { ...s, loaded: { ...l, link: r.link, clock: tick(r.clock, now) } };
}

export function snapshotOf(s: PlayerState, now: number): Snapshot {
  const l = s.loaded;
  return {
    loadId: s.loadId,
    fileName: l?.fileName ?? null,
    doc: l?.doc ?? null,
    view: l ? viewAt(l.clock, l.plan, now) : null,
    link: l ? linkViewAt(l.link, l.clock, l.linkPlan, l.plan.lengthMs, now, l.following && !l.linkPlan.manualOnly) : null,
    error: s.error,
  };
}
