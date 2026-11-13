// Which companion actions do something now without stopping the following of the music (ADR 0005
// section 5): the `allowed` of companion_state. Pure. Taken from the same routing as the
// presenter's controls (`routeFor`), so the phone is never offered a control that hands the clock
// over to the manual clock. The one exception is the undo of a resync (ADR 0001).
import { viewAt } from "../clock/view.ts";
import type { PlayerState } from "../player-state.ts";
import { routeFor } from "../player-state.ts";
import { COMPANION_ACTIONS, toClockCommand, UNDO_ACTION } from "./actions.ts";
import type { CompanionAction } from "./actions.ts";

/** The undo of an announced resync is available now (the same test as the presenter's view). */
export function undoAvailable(s: PlayerState, now: number): boolean {
  const u = s.loaded?.link.undo ?? null;
  return u !== null && now <= u.until;
}

function isAllowed(s: PlayerState, action: CompanionAction, now: number, canSend: boolean): boolean {
  const l = s.loaded;
  if (l === null) return false;
  if (action === UNDO_ACTION) return undoAvailable(s, now);
  // A nudge moves the clock: never while following (ADR 0005 section 4), whatever the state.
  if (action === "nudge") return l.link.mode === "manual" && routeFor(s, { type: "jump", deltaMs: 5000 }, canSend) === null;
  const cmd = toClockCommand(action);
  if (cmd === null) return false;
  const route = routeFor(s, cmd, canSend);
  if (route?.kind === "manual") return false;
  const status = l.clock.status;
  // Sent to the music: whether it plays is the music app's last word, not the clock's (the
  // clock stands still while it holds at a window's end).
  const toMusic = route?.kind === "transport" && route.alsoClock !== true;
  const plays = toMusic ? l.link.playing : status === "running";
  switch (action) {
    case "start":
      return status === "ready";
    case "pause":
      return plays;
    case "resume":
      return status !== "ready" && status !== "ended" && !plays;
    case "skip":
      return toMusic || (status !== "ended" && viewAt(l.clock, l.plan, now).nextIntervalIndex !== null);
  }
}

/** The allowed actions, in the contract's order. Empty while no class is open. */
export function allowedActions(s: PlayerState, now: number, canSend: boolean): CompanionAction[] {
  return COMPANION_ACTIONS.filter((a) => isAllowed(s, a, now, canSend));
}
