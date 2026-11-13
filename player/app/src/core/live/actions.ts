// The companion's actions and the player command each one is (ADR 0005 section 4). Pure.
// This list is the whole set of things a phone can ask: the clock and the music app's play, pause
// and next, nothing else. A new action is a contract change (schema/live/v1/command.schema.json).
import { parseClockCommand } from "../commands.ts";
import type { ClockCommand } from "../commands.ts";
import type { ForwardedCommand } from "../../../../../schema/generated/ts/live-command-forwarded.d.ts";

export type CompanionAction = ForwardedCommand["action"];

export const COMPANION_ACTIONS: readonly CompanionAction[] = ["start", "pause", "resume", "skip", "nudge", "undo_resync"];

export const isCompanionAction = (v: unknown): v is CompanionAction => typeof v === "string" && (COMPANION_ACTIONS as readonly string[]).includes(v);

/** The one action that may end the following of the music: ADR 0001's undo of a resync. */
export const UNDO_ACTION = "undo_resync" satisfies CompanionAction;

const SIMPLE: Readonly<Record<Exclude<CompanionAction, "nudge">, ClockCommand["type"]>> = {
  start: "start",
  pause: "pause",
  resume: "resume",
  skip: "next",
  undo_resync: "undo",
};

/**
 * The player command for an action, through the presenter's own shape check, or null. A nudge
 * needs `deltaMs` of exactly plus or minus JUMP_MS; every other action must come without one.
 */
export function toClockCommand(action: CompanionAction, deltaMs?: number): ClockCommand | null {
  if (action === "nudge") return deltaMs === undefined ? null : parseClockCommand({ type: "jump", deltaMs });
  if (deltaMs !== undefined || !Object.hasOwn(SIMPLE, action)) return null;
  return parseClockCommand({ type: SIMPLE[action] });
}
