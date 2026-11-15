// A position pattern's light (scene.md "What drives what", S8): energy only. The beams are at full
// brightness on the "up" side and at `--pattern-down` (72 %) on the "down" side, and the first beat of
// each side carries a 5 % accent in place of that beat's lift (the flash budget, scene.md "Beat-like light"). Brightness only: no angle, height or shape comes from a pattern
// (rule 4), and it runs only where the beat is known (the Beat level, S8). The pattern is read from
// the class's interval by shape and checked, never trusted. Pure.

import { ACCENT, BEATS_PER_BAR, beatsAt, intervalIndexAt, liftShape } from "../../model/src/index.ts";
import type { BeatLevel, SceneClass } from "../../model/src/index.ts";
import { nth } from "./lookup.ts";

export const ACCENT_DEPTH = ACCENT;
export const DEFAULT_DOWN = 0.72;
/** A side shorter than this leaves no room for its step (a frame mark, at least 500 ms from the last): the pattern's light is left out (S6). */
export const MIN_SIDE_SECONDS = 0.5;
const MAX_SIDES = 4;

export interface ScenePattern {
  /** "standing" is the up side, "seated" the down side. */
  readonly positions: readonly ("standing" | "seated")[];
  readonly beats: readonly number[];
  readonly startOn: "interval_start" | "next_downbeat";
}

/** The pattern an interval carries, or null where it holds none or one of the wrong shape. */
export function readPattern(raw: unknown): ScenePattern | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { positions, beats, startOn } = raw as { positions?: unknown; beats?: unknown; startOn?: unknown };
  if (!Array.isArray(positions) || !Array.isArray(beats) || positions.length < 2 || positions.length > MAX_SIDES || positions.length !== beats.length) return null;
  if (!positions.every((p) => p === "standing" || p === "seated")) return null;
  if (!beats.every((b) => typeof b === "number" && Number.isInteger(b) && b >= 1 && b <= 64)) return null;
  if (startOn !== "interval_start" && startOn !== "next_downbeat") return null;
  return { positions: positions as ScenePattern["positions"], beats: beats as number[], startOn };
}

export interface PatternLight {
  /** 1 on the up side, `down` on the down side. */
  readonly level: number;
  /** 0 to 0.05: the accent of the first beat of a side (rise 40 ms, fall 200 ms). */
  readonly accent: number;
}
export const NO_PATTERN_LIGHT: PatternLight = { level: 1, accent: 0 };

export interface PatternLightInput {
  readonly cls: SceneClass;
  readonly classMs: number;
  readonly songIndex: number;
  readonly songPosMs: number;
  readonly level: BeatLevel;
  /** `--pattern-down`. */
  readonly down: number;
  /** The look is the still rig, or the rig has no beat to follow. */
  readonly still: boolean;
}

/** Where the beat count stands in the pattern: the side, and the beats into it (0 at its first beat). */
function sideAt(p: ScenePattern, beatsIntoPattern: number): { up: boolean; into: number } {
  const cycle = p.beats.reduce((a, b) => a + b, 0);
  let rest = beatsIntoPattern % cycle;
  for (let k = 0; k < p.beats.length; k++) {
    const len = p.beats.at(k) ?? 0;
    if (rest < len) return { up: p.positions.at(k) === "standing", into: rest };
    rest -= len;
  }
  return { up: true, into: 0 };
}

export function patternLight(a: PatternLightInput): PatternLight {
  if (a.still || a.level !== "Beat") return NO_PATTERN_LIGHT;
  const iv = nth(a.cls.intervals, intervalIndexAt(a.cls, a.classMs));
  const song = nth(a.cls.songs, a.songIndex);
  const pattern = readPattern(iv?.pattern);
  const bpm = song?.bpm;
  if (iv === undefined || pattern === null || bpm === undefined || !(bpm > 0)) return NO_PATTERN_LIGHT;
  if (Math.min(...pattern.beats) * (60 / bpm) < MIN_SIDE_SECONDS) return NO_PATTERN_LIGHT;
  const now = beatsAt(song?.anchors, a.songPosMs);
  const start = beatsAt(song?.anchors, a.songPosMs - (a.classMs - iv.startMs));
  if (now === null || start === null) return NO_PATTERN_LIGHT;
  const from = pattern.startOn === "next_downbeat" ? Math.ceil(start / BEATS_PER_BAR - 1e-9) * BEATS_PER_BAR : Math.floor(start);
  if (now < from) return NO_PATTERN_LIGHT; // before the first downbeat: as the zone
  const { up, into } = sideAt(pattern, now - from);
  return { level: up ? 1 : Math.min(1, Math.max(0, a.down)), accent: ACCENT_DEPTH * liftShape((into * 60_000) / bpm) };
}
