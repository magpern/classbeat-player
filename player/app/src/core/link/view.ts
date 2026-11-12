// What the screens show of the music link (ADR 0001 link states, rules 5 to 7). Pure.
import { positionAt } from "../clock/clock.ts";
import type { ClockState } from "../clock/clock.ts";
import { timeLeftMs } from "./totals.ts";
import type { LinkModel, LinkPlan, LinkStateName } from "./types.ts";

export interface LinkView {
  readonly mode: "following" | "manual";
  /** False when no reader exists or the class is manual only: there is nothing to follow. */
  readonly available: boolean;
  /** A reader exists but cannot work on this computer: the reason following is not offered. */
  readonly unavailable: boolean;
  readonly state: LinkStateName;
  /** The clock is marked on screen while it only guesses (Coasting, Off the list). */
  readonly guessing: boolean;
  readonly songIndex: number | null;
  /** Rule 6: the clock holds at the window's end; the last interval stays on screen. */
  readonly held: boolean;
  /** Rule 6: the elastic countdown of the last interval while holding, else null. */
  readonly holdRemainingMs: number | null;
  /** Ambiguous: the occurrences the instructor can pick between. */
  readonly candidates: readonly number[];
  /** Rule 5: the announcement text ("resynced, 30 s back") while its undo is available. */
  readonly announcement: string | null;
  readonly canUndo: boolean;
  /** Rule 7: shown beside the planned one once measured; `differs` says when they do not agree. */
  readonly plannedCrossfadeMs: number;
  readonly measuredCrossfadeMs: number | null;
  readonly crossfadeDiffers: boolean;
  /** Rule 7: time left follows the measurement. */
  readonly classRemainingMs: number;
}

/** A measured crossfade this close to the planned one is not worth a remark. */
export const CROSSFADE_DIFF_MS = 1000;

export function linkViewAt(l: LinkModel, clock: ClockState, plan: LinkPlan, lengthMs: number, now: number, available: boolean, unavailable = false): LinkView {
  const live = l.announce !== null && now <= l.announce.until;
  const holdRemaining = l.held && l.holdUntil !== null ? Math.max(0, l.holdUntil - now) : null;
  const measured = l.measuredCrossfadeMs;
  return {
    mode: l.mode,
    available,
    unavailable,
    state: l.state,
    guessing: l.state === "Coasting" || l.state === "Off the list",
    songIndex: l.songIndex,
    held: l.held,
    holdRemainingMs: holdRemaining,
    candidates: l.state === "Ambiguous" && l.amb ? l.amb.candidates : [],
    announcement: live && l.announce ? l.announce.text : null,
    canUndo: l.undo !== null && now <= l.undo.until,
    plannedCrossfadeMs: plan.plannedCrossfadeMs,
    measuredCrossfadeMs: measured,
    crossfadeDiffers: measured !== null && Math.abs(measured - plan.plannedCrossfadeMs) >= CROSSFADE_DIFF_MS,
    classRemainingMs: timeLeftMs({
      lengthMs,
      classMs: positionAt(clock, now),
      songIndex: l.songIndex,
      songCount: plan.songs.length,
      plannedCrossfadeMs: plan.plannedCrossfadeMs,
      measuredCrossfadeMs: measured,
      holdRemainingMs: holdRemaining,
    }),
  };
}
