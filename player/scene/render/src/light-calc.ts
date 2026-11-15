// What brightness each part of the rig gets (scene.md "What drives what", "How much of the music
// is known", "States"): which fixtures are lit, the beat lift, the master level of a link state and
// the wall's chase. Every number here is a brightness, never an angle (rule 4). Pure.

import type { BeatLevel, Frame, LinkInput, QualityLevel } from "../../model/src/index.ts";
import { FIXTURES, MAX_BEAT_LIFT, QUALITY, TEMPO_PULSE_DEPTH } from "../../model/src/index.ts";
import { lookup } from "./lookup.ts";

export const BUILD_LIFT_MAX = 0.55;
export const OFF_LIST_LEVEL = 0.6;
export const SONG_CHANGE_DIM = 0.25;
const MAX_LIFTS_PER_SECOND = 3;
/** The fixture the breakdown's one slow beam is: the middle of the front truss. */
const BREAKDOWN_FIXTURE = FIXTURES.findIndex((f) => f.layer === "front" && f.index === 3);

/** `count` of the 22 fixtures, spread evenly along the rig (never the first `count`). */
export function litMask(count: number): boolean[] {
  const n = FIXTURES.length;
  const c = Math.max(0, Math.min(n, Math.round(count)));
  return FIXTURES.map((_, j) => Math.floor(((j + 1) * c) / n) > Math.floor((j * c) / n));
}

/** Which fixtures are on this frame: the zone's count capped by the quality level; the drop's fan lights all; a breakdown one beam. */
export function fixturesLit(frame: Frame, quality: QualityLevel): boolean[] {
  const cap = lookup(QUALITY, quality).fixtures;
  if (frame.moments.breakdown) return FIXTURES.map((_, i) => i === BREAKDOWN_FIXTURE);
  return litMask(frame.moments.fan ? cap : Math.min(frame.energy.lit, cap));
}

/** Beats per second never lifts more than 3 times: above 180 bpm every second beat. */
function liftBeat(beats: number, bpm: number): number {
  const whole = Math.floor(beats);
  return whole % beatStride(bpm) === 0 ? beats - whole : -1;
}

/** 1, or 2 above 180 bpm: nothing lifts or steps more than 3 times a second. */
export function beatStride(bpm: number): 1 | 2 {
  return bpm / 60 > MAX_LIFTS_PER_SECOND ? 2 : 1;
}

export interface LiftInput {
  readonly frame: Frame;
  readonly bpm: number | undefined;
  /** Beats since the first anchor (null with no anchors). */
  readonly beats: number | null;
  readonly songPosMs: number;
  readonly reduced: boolean;
}

/**
 * The beat lift, 0 to 0.55: a brightness added to every lit beam. Only at the Beat level (on the
 * anchor beat); a shallow pulse at Tempo only on its own phase; nothing at None, and nothing in the
 * still rig. A build deepens it to at most 55 %.
 */
export function beatLift({ frame, bpm, beats, songPosMs, reduced }: LiftInput): number {
  if (reduced || bpm === undefined || !(bpm > 0)) return 0;
  const level: BeatLevel = frame.level;
  const depth = frame.moments.gather ? Math.min(BUILD_LIFT_MAX, frame.energy.beatLift * 1.4) : Math.min(MAX_BEAT_LIFT, frame.energy.beatLift);
  const decay = (phase: number) => (phase < 0 ? 0 : (1 - phase) ** 3);
  if (level === "Beat" && beats !== null) return depth * decay(liftBeat(beats, bpm));
  if (level === "Tempo only") return TEMPO_PULSE_DEPTH * decay(liftBeat((songPosMs * bpm) / 60_000, bpm));
  return 0;
}

/** The master level of the whole rig for the link state (scene.md "States"). */
export function masterLevel(link: LinkInput, down: number, songChangeDim: boolean): number {
  const base = link.state === "Paused" || link.held === true ? down : link.state === "Off the list" ? OFF_LIST_LEVEL : 1;
  return songChangeDim ? base * SONG_CHANGE_DIM : base;
}

/** The burst's share of white: 1 at its start, linear to 0 over `decayMs`. */
export function burstEnvelope(msSince: number | null, decayMs: number): number {
  return msSince === null || msSince < 0 || msSince >= decayMs ? 0 : 1 - msSince / decayMs;
}

export type WallMode = Frame["energy"]["wall"];
export const WALL_COLUMNS = 56;
/**
 * One wall dot's brightness, 0 to 1: a slow wave, plus a chase that steps with the beat where the
 * zone has one and the beat is known (`chaseStep` null otherwise: no chase without the beat, S8).
 */
export function wallDot(col: number, row: number, mode: WallMode, chaseStep: number | null, seconds: number, reduced: boolean): number {
  if (reduced) return 0.2;
  const wave = 0.18 + 0.12 * Math.sin(col * 0.35 + row * 0.5 + seconds * 0.6);
  if (mode === "slow wave" || chaseStep === null) return wave;
  const head = (chaseStep * 7) % WALL_COLUMNS;
  const dist = Math.min(Math.abs(col - head), mode === "beat chase both ways" ? Math.abs(col - (WALL_COLUMNS - 1 - head)) : WALL_COLUMNS);
  return wave + (dist < 3 ? 0.6 * (1 - dist / 3) : 0);
}
