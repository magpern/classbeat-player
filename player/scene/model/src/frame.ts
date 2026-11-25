// One frame of the rig from a class and a moment in it: the join of the pieces. The interval
// supplies the zone (colour and energy scalars) and nothing that reaches a direction. Pure.

import type { BeatAnchor, Phrase } from "./beat-grid.ts";
import { FIRST_PHRASE, phraseAt } from "./beat-grid.ts";
import type { BeatLevel, LinkInput } from "./beat-level.ts";
import { allowanceFor, beatLevel } from "./beat-level.ts";
import { FIXTURES, beamDirection } from "./beams.ts";
import type { Direction } from "./beams.ts";
import type { RigColours } from "./colour.ts";
import { rigColours } from "./colour.ts";
import type { Energy } from "./energy.ts";
import { energyFor } from "./energy.ts";
import { gatedMoments } from "./link-gate.ts";
import { lookForSong } from "./looks.ts";
import type { Look } from "./looks.ts";
import { momentsAt } from "./moments.ts";
import { turningMoments } from "./turn-moments.ts";
import type { Moments, SongMoment } from "./moments.ts";

export interface SceneSong {
  readonly bpm?: number;
  readonly anchors?: readonly BeatAnchor[];
  readonly moments?: readonly SongMoment[];
  /** How long the song plays, ms: a drop less than 2.25 s before its end has no fan turn (scene.md "Moment windows"). Unknown: every drop has one. */
  readonly lengthMs?: number;
}
/** An interval as the scene sees it. Only `zone` may matter to the rig (as scalars). */
export interface SceneInterval {
  readonly startMs: number;
  readonly zone: number;
  /** The class's position pattern, read by `readPattern` (marks, pattern light): the one field besides the start and zone, and the type is closed so no reading can ride along. */
  readonly pattern?: unknown;
}
export interface SceneClass {
  readonly songs: readonly SceneSong[];
  readonly intervals: readonly SceneInterval[];
  readonly endMs: number;
}

export interface FrameInput {
  readonly cls: SceneClass;
  readonly classMs: number;
  readonly songIndex: number;
  readonly songPosMs: number;
  /** The motion phase, advanced by the caller with `advancePhase`. */
  readonly phaseDeg: number;
  readonly link: LinkInput;
}
export interface Frame {
  readonly look: Look;
  readonly level: BeatLevel;
  readonly phrase: Phrase;
  readonly moments: Moments;
  readonly energy: Energy;
  readonly colours: RigColours;
  readonly directions: readonly Direction[];
}

export function intervalIndexAt(cls: SceneClass, classMs: number): number {
  let at = 0;
  cls.intervals.forEach((iv, i) => { if (iv.startMs <= classMs) at = i; });
  return at;
}

export function sceneFrame(input: FrameInput): Frame {
  const { cls, classMs, songIndex, songPosMs, phaseDeg, link } = input;
  const song = cls.songs[songIndex];
  const at = intervalIndexAt(cls, classMs);
  const iv = cls.intervals[at];
  if (!iv) throw new RangeError("a class needs at least one interval");
  const next = cls.intervals[at + 1];
  const level = beatLevel(link, song ?? null);
  const phrase = allowanceFor(level).phrase ? phraseAt(song?.anchors, songPosMs) : FIRST_PHRASE;
  const moments = gatedMoments(link, momentsAt(song?.moments, song?.bpm, songPosMs));
  const turning = gatedMoments(link, turningMoments(song?.moments, song?.bpm, songPosMs, song?.lengthMs));
  const look = lookForSong(songIndex);
  return {
    look, level, phrase, moments,
    energy: energyFor(iv.zone),
    colours: rigColours(iv.zone, next ? next.zone : null, next ? next.startMs - classMs : null),
    directions: FIXTURES.map((fixture) => beamDirection({ look, fixture, phaseDeg, phrase, moments: turning })),
  };
}
