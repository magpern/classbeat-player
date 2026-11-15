// The class's stage and what each stage and link state does to the rig's brightness and movement
// (scene.md "States"): the house look before the start, the house lights up when finished, and the
// holding look off the list. Every number here is a brightness or a rate, never an angle (rule 4).
// Pure.

import type { LinkInput, QualityLevel, SceneClass } from "../../model/src/index.ts";
import { QUALITY } from "../../model/src/index.ts";
import { litMask, masterLevel } from "./light-calc.ts";
import { lookup } from "./lookup.ts";

/** Before the clock starts, running, and the class over. */
export type Stage = "before" | "running" | "finished";

/** Movement is halved off the list (the holding look) and before the start (two slow beams). */
export const HALVED_MOVEMENT = 0.5;
/** The house look before the start: two beams lit. */
export const HOUSE_BEAMS = 2;

/** The shell says "before" (the clock is ready, not started); the end of the class is also read from the class clock. */
export function stageOf(cls: SceneClass, classMs: number, given: Stage | undefined): Stage {
  if (given === "before") return "before";
  return given === "finished" || classMs >= cls.endMs ? "finished" : "running";
}

/** The model's movement scale: halved off the list and before the start. */
export function movementScale(stage: Stage, link: LinkInput): number {
  return stage === "before" || link.state === "Off the list" ? HALVED_MOVEMENT : 1;
}

/**
 * The master level of the whole rig: lights down before the start (as paused), the house lights
 * at `house` when finished, else the link state's (and the song-change dim).
 */
export function stageMaster(stage: Stage, link: LinkInput, tokens: { readonly down: number; readonly house: number }, songChangeDim: boolean): number {
  if (stage === "before") return tokens.down;
  if (stage === "finished") return tokens.house;
  return masterLevel(link, tokens.down, songChangeDim);
}

/** Which fixtures the stage lights, or null to leave it to the frame (a running class). */
export function stageLit(stage: Stage, quality: QualityLevel): boolean[] | null {
  if (stage === "before") return litMask(HOUSE_BEAMS);
  return stage === "finished" ? litMask(lookup(QUALITY, quality).fixtures) : null;
}

/** Whether the LED wall plays: dark before the start, white and still when finished (the rig draws that), else as the quality level says. */
export function wallPlays(stage: Stage): boolean {
  return stage !== "before";
}
