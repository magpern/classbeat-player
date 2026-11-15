// The class's stage and what each stage and link state does to the rig's brightness and movement
// (scene.md "States"): the house look before the start and the holding look off the list.
// Every number here is a brightness or a rate, never an angle (rule 4).
// Pure.

import type { LinkInput } from "../../model/src/index.ts";
import { litMask, masterLevel } from "./light-calc.ts";

/** Before the clock starts, and running. (The finished house look is the flash budget's, #577: it is a change in S6's sense.) */
export type Stage = "before" | "running";

/** Movement is halved off the list (the holding look) and before the start (two slow beams). */
export const HALVED_MOVEMENT = 0.5;
/** The house look before the start: two beams lit. */
export const HOUSE_BEAMS = 2;

/** The shell says "before" (the clock is ready, not started); any other state is running. */
export function stageOf(given: Stage | undefined): Stage {
  return given === "before" ? "before" : "running";
}

/** The model's movement scale: halved off the list and before the start. */
export function movementScale(stage: Stage, link: LinkInput): number {
  return stage === "before" || link.state === "Off the list" ? HALVED_MOVEMENT : 1;
}

/**
 * The master level of the whole rig: lights down before the start (as paused), else the link
 * state's (and the song-change dim).
 */
export function stageMaster(stage: Stage, link: LinkInput, tokens: { readonly down: number }, songChangeDim: boolean): number {
  if (stage === "before") return tokens.down;
  return masterLevel(link, tokens.down, songChangeDim);
}

/** Which fixtures the stage lights, or null to leave it to the frame (a running class). */
export function stageLit(stage: Stage): boolean[] | null {
  return stage === "before" ? litMask(HOUSE_BEAMS) : null;
}

/** Whether the LED wall plays: dark before the start, else as the quality level says. */
export function wallPlays(stage: Stage): boolean {
  return stage !== "before";
}
