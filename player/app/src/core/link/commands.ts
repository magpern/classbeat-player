// The instructor's controls over the link: undo a resync, go to the manual clock, follow the
// music again, pick an occurrence of a repeated recording. Pure.
import type { ClockState } from "../clock/clock.ts";
import { setClock } from "./clock-moves.ts";
import { DEFAULT_LINK_CONFIG } from "./types.ts";
import type { LinkConfig, LinkEvent, LinkModel } from "./types.ts";
import { HANDOVER_TEXT } from "./while-following.ts";

export interface CommandResult {
  readonly link: LinkModel;
  readonly clock: ClockState;
  readonly event: LinkEvent | null;
}

/**
 * Undo a resync (rule 5): back to the manual clock at the place it would have run to since the
 * resync (ADR 0001, "at the earlier place"), so the time since then is not lost.
 */
export function undo(link: LinkModel, clock: ClockState, now: number): CommandResult {
  if (link.undo === null || now > link.undo.until) {
    return { link: { ...link, undo: null, announce: null }, clock, event: "undo_unavailable" };
  }
  return {
    link: { ...link, mode: "manual", state: "Manual", undo: null, announce: null, held: false, holdUntil: null, force: false },
    clock: setClock(clock, link.undo.clockMs + Math.max(0, now - link.undo.at), true, now),
    event: "undo",
  };
}

/** Choose the manual clock; the clock keeps going as it is. */
export function goManual(link: LinkModel, clock: ClockState): CommandResult {
  return { link: { ...link, mode: "manual", state: "Manual", undo: null, announce: null, held: false, holdUntil: null }, clock, event: "manual" };
}

/** A control that moves the clock itself while following: manual from now on, and said so. */
export function handOver(link: LinkModel, clock: ClockState, now: number, cfg: LinkConfig = DEFAULT_LINK_CONFIG): CommandResult {
  const announce = { text: HANDOVER_TEXT, deltaMs: 0, until: now + cfg.undoWindowMs };
  return { link: { ...link, mode: "manual", state: "Manual", undo: null, announce, held: false, holdUntil: null, force: false }, clock, event: "manual" };
}

/** Follow the music again: the next fresh reading goes to where the music is (a resync). */
export function relink(link: LinkModel, clock: ClockState, following: boolean): CommandResult {
  if (!following) return { link, clock, event: null };
  return { link: { ...link, mode: "following", state: "Manual", undo: null, announce: null }, clock, event: "relink" };
}

/** Pick an occurrence of a repeated recording. Only while Ambiguous, and only one of its candidates. */
export function pickOccurrence(link: LinkModel, clock: ClockState, songIndex: number): CommandResult {
  if (link.state !== "Ambiguous" || link.amb === null || !link.amb.candidates.includes(songIndex)) return { link, clock, event: null };
  return { link: { ...link, pick: songIndex, force: true }, clock, event: "pick" };
}
