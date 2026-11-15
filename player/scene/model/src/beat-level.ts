// How much of the music is known (scene.md, S8). Nothing beat-like is ever guessed. Pure.

import type { BeatAnchor } from "./beat-grid.ts";
import { TEMPO_PULSE } from "./flash-budget.ts";

export type BeatLevel = "Beat" | "Tempo only" | "None";
export type LinkStateName = "Locked" | "Paused" | "Coasting" | "Off the list" | "Ambiguous" | "Manual";
export type StartOn = "interval_start" | "next_downbeat";

export interface LinkInput {
  readonly state: LinkStateName;
  /** The link is holding its last reading (as the 2D screen): no lock. */
  readonly held?: boolean;
}

export interface SongTiming {
  readonly bpm?: number | undefined;
  readonly anchors?: readonly BeatAnchor[] | undefined;
}

export function beatLevel(link: LinkInput, song: SongTiming | null): BeatLevel {
  if (link.state !== "Locked" || link.held === true) return "None";
  if (song === null || song.bpm === undefined || !(song.bpm > 0)) return "None";
  return song.anchors !== undefined && song.anchors.length > 0 ? "Beat" : "Tempo only";
}

export interface BeatAllowance {
  readonly beatLift: boolean;
  readonly wallChase: boolean;
  readonly phrase: boolean;
  readonly barsLine: boolean;
  readonly patternAccent: boolean;
  /** Depth of the shallow tempo pulse of the lit beams (0 = none). */
  readonly tempoPulse: number;
  /** Which `start_on` values the pattern count runs for. */
  readonly patternCount: readonly StartOn[];
}

export const TEMPO_PULSE_DEPTH = TEMPO_PULSE;

export const ALLOWED: Readonly<Record<BeatLevel, BeatAllowance>> = {
  Beat: { beatLift: true, wallChase: true, phrase: true, barsLine: true, patternAccent: true, tempoPulse: 0, patternCount: ["interval_start", "next_downbeat"] },
  "Tempo only": { beatLift: false, wallChase: false, phrase: false, barsLine: false, patternAccent: false, tempoPulse: TEMPO_PULSE_DEPTH, patternCount: ["interval_start"] },
  None: { beatLift: false, wallChase: false, phrase: false, barsLine: false, patternAccent: false, tempoPulse: 0, patternCount: [] },
};

export function allowanceFor(level: BeatLevel): BeatAllowance {
  return ALLOWED[level];
}

/** Whether the pattern count may run (S14); otherwise the block says why instead. */
export function patternCountRuns(level: BeatLevel, startOn: StartOn): boolean {
  return ALLOWED[level].patternCount.includes(startOn);
}
