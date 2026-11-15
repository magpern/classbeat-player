// The position pattern's side and count (scene.md S14, "Intervals first"). Nothing is guessed: the
// count runs only at the beat level the pattern's `start_on` allows (model `patternCountRuns`),
// otherwise the block says why it has none. Pure.

import { beatsAt, patternCountRuns } from "../../model/src/index.ts";
import type { BeatLevel } from "../../model/src/index.ts";
import type { TextInterval, TextPattern, TextSong } from "./text-types.ts";
import { sideWord } from "./text-words.ts";

export const NOTE_NO_COUNT = "Count from the music";
export const NOTE_NO_TEMPO = "No tempo: count from the music";
export const NOTE_STARTS_SOON = "starts on the next bar";
const BEATS_PER_BAR = 4;

export type PatternState =
  | { readonly kind: "count"; readonly side: "UP" | "DOWN"; readonly left: number; readonly total: number; readonly then: string }
  | { readonly kind: "soon"; readonly side: "UP" | "DOWN"; readonly text: string }
  | { readonly kind: "note"; readonly text: string };

/** "then down", "then up", "then up again" (the same side twice in a row). */
function thenWords(p: TextPattern, k: number): string {
  const here = p.positions.at(k);
  const next = p.positions.at((k + 1) % p.positions.length);
  return `then ${next === "standing" ? "up" : "down"}${next === here ? " again" : ""}`;
}

/** The entry the beat index falls in, and the beats left on it (8 at its start, 1 at its last beat). */
function entryAt(p: TextPattern, index: number): { k: number; left: number } {
  const cycle = p.beats.reduce((a, b) => a + b, 0);
  let rest = cycle > 0 ? index % cycle : 0;
  for (let k = 0; k < p.beats.length; k++) {
    const len = p.beats.at(k) ?? 0;
    if (rest < len) return { k, left: len - rest };
    rest -= len;
  }
  return { k: 0, left: p.beats.at(0) ?? 0 };
}

export interface PatternInput {
  readonly iv: TextInterval;
  readonly song: TextSong | null;
  readonly level: BeatLevel;
  readonly classMs: number;
  readonly songPosMs: number;
}

export function patternState({ iv, song, level, classMs, songPosMs }: PatternInput): PatternState | null {
  const p = iv.pattern;
  if (p === null) return null;
  const bpm = song?.bpm;
  if (level === "None") return { kind: "note", text: bpm === undefined ? NOTE_NO_TEMPO : NOTE_NO_COUNT };
  if (song === null || bpm === undefined || !(bpm > 0)) return { kind: "note", text: NOTE_NO_TEMPO };
  if (!patternCountRuns(level, p.startOn)) return { kind: "note", text: NOTE_NO_COUNT };
  const first = p.positions.at(0) ?? "seated";
  let index: number;
  if (level === "Beat") {
    const now = beatsAt(song.anchors, songPosMs);
    const start = beatsAt(song.anchors, songPosMs - (classMs - iv.startMs));
    if (now === null || start === null) return { kind: "note", text: NOTE_NO_COUNT };
    const from = p.startOn === "next_downbeat" ? Math.ceil(start / BEATS_PER_BAR - 1e-9) * BEATS_PER_BAR : Math.floor(start);
    if (now < from) return { kind: "soon", side: sideWord(first), text: NOTE_STARTS_SOON };
    index = Math.floor(now) - from;
  } else {
    index = Math.floor(((classMs - iv.startMs) * bpm) / 60_000);
  }
  const { k, left } = entryAt(p, Math.max(0, index));
  return { kind: "count", side: sideWord(p.positions.at(k) ?? first), left, total: p.beats.at(k) ?? left, then: thenWords(p, k) };
}
