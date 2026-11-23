// The score (scene.md "The score", S3, S13): the intervals as blocks in the zone colour with number,
// length, name and cue, the songs as clips, "now" fixed at 10 vw. Flat and opaque: positions are
// shares of the width and nothing else (no perspective, no height from an interval: rule 4). Pure.

import type { BeatAnchor } from "../../model/src/index.ts";
import { NUMBER_EM, TEXT_EM, widthVw } from "./text-fit-calc.ts";
import { patternWords, clockText } from "./text-words.ts";
import type { TextClass, TextInterval, TextInput, TextSong } from "./text-types.ts";
import type { IntervalBlock, ScoreView, SongClip, Strip } from "./text-view.ts";

export const NOW_X = 10;
export const SAFE_RIGHT = 95;
/** A block that starts right of this has too little inside the safe area to hold its number. */
const NUMBER_CUT_X = 91;
const MIN_NUMBER_BLOCK_VW = 2.5;
const PAD_VW = 0.6;
const GAP_VW = 0.25;
const MIN_CUE_VW = 6;
const PHRASE_BEATS = 16;

/** 8 minutes ahead at 16:9 and wider, 6 at 3:2 and narrower, to the screen's right edge. */
export const aheadMinutes = (narrow: boolean): number => (narrow ? 6 : 8);

function momentWord(kind: string): string | null {
  return kind === "drop" ? "Drop" : kind === "build" ? "Build" : kind === "breakdown" ? "Breakdown" : null;
}

/** The song position of beat number `beat` (from the first anchor), the inverse of the model's `beatsAt`. */
export function msAtBeat(anchors: readonly BeatAnchor[], beat: number): number {
  let beats = 0;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors.at(i);
    if (a === undefined) break;
    const next = anchors.at(i + 1);
    const span = next === undefined ? Infinity : ((next.at_ms - a.at_ms) * a.bpm) / 60_000;
    if (beat < beats + span) return a.at_ms + ((beat - beats) * 60_000) / a.bpm;
    beats += span;
  }
  return 0;
}

interface Scale {
  readonly now: number;
  readonly perMs: number;
  readonly aspect: number;
  readonly narrow: boolean;
}
const xOf = (s: Scale, ms: number): number => NOW_X + (ms - s.now) * s.perMs;

/** The pattern's beat strip: dark on the "up" beats, clear on the "down" beats, on the pattern's own beat grid. */
function stripFor(iv: TextInterval, song: TextSong | null, s: Scale, x0: number): Strip | null {
  const p = iv.pattern;
  const bpm = song?.bpm;
  if (p === null || song === null || bpm === undefined || !(bpm > 0)) return null;
  if (p.startOn === "next_downbeat" && (song.anchors === undefined || song.anchors.length === 0)) return null;
  const cycle = p.beats.reduce((a, b) => a + b, 0);
  if (!(cycle > 0)) return null;
  let at = 0;
  const parts = p.positions.map((side, i) => {
    const len = p.beats.at(i) ?? 0;
    const part = { from: at / cycle, to: (at + len) / cycle, up: side === "standing" };
    at += len;
    return part;
  });
  const beatMs = 60_000 / bpm;
  const startX = xOf(s, iv.startMs);
  return { cycleVw: cycle * beatMs * s.perMs, offsetVw: startX - x0, parts };
}

function intervalBlock(cls: TextClass, i: number, iv: TextInterval, s: Scale, away: boolean): IntervalBlock | null {
  const end = iv.startMs + iv.lengthMs;
  const [rawX0, rawX1] = [xOf(s, iv.startMs), xOf(s, end)];
  const [x0, x1] = [Math.max(0, rawX0), Math.min(100, rawX1)];
  if (x1 <= 0 || x0 >= 100) return null;
  const key = `i${i}`;
  const base = { key, zone: iv.zone, x0, x1, number: null, length: null, name: null, detail: null, strip: null };
  if (away) return { ...base, kind: "neutral", textLeft: x0, textRight: x0 }; // merged away (P1): its own block, no number and no colour
  if (away) return { ...base, kind: "neutral", textLeft: x0, textRight: x0 }; // merged away (P1): its own block, no number and no colour
  if (away) return { ...base, kind: "neutral", textLeft: x0, textRight: x0 }; // merged away (P1): its own block, no number and no colour
  if (end <= s.now) return { ...base, kind: "past", textLeft: x0, textRight: x0 };
  if (x0 >= NUMBER_CUT_X) return null;
  const textLeft = Math.max(x0, NOW_X) + PAD_VW;
  const textRight = Math.min(x1 - PAD_VW, SAFE_RIGHT);
  const avail = textRight - textLeft;
  const [numVh, lenVh] = s.narrow ? [5, 3.72] : [Math.min(5, 2.8 * s.aspect), Math.min(3.72, 2.1 * s.aspect)];
  const numW = widthVw(String(iv.zone).length, numVh, s.aspect, NUMBER_EM);
  const length = clockText(iv.lengthMs);
  const lenW = widthVw(length.length, lenVh, s.aspect, NUMBER_EM);
  if (x1 - x0 < MIN_NUMBER_BLOCK_VW || avail < numW) return { ...base, kind: "neutral", textLeft, textRight };
  const nameW = widthVw(iv.name.length, 3.1, s.aspect, TEXT_EM);
  const showLength = avail >= numW + GAP_VW + lenW;
  const showName = showLength && avail >= numW + GAP_VW + lenW + GAP_VW * 2 + nameW;
  const words = iv.pattern ? patternWords(iv.pattern) : null;
  const detail = avail >= MIN_CUE_VW ? [words, iv.cue].filter((t): t is string => t !== null && t.length > 0).join(" · ") : null;
  const song = cls.songs.find((c) => iv.startMs >= c.startMs && iv.startMs < c.startMs + c.lengthMs) ?? null;
  return {
    ...base, kind: "zone", textLeft, textRight, number: String(iv.zone),
    length: showLength ? length : null, name: showName ? iv.name : null, detail: detail === "" ? null : detail,
    strip: stripFor(iv, song, s, x0),
  };
}

function songClip(i: number, song: TextSong, s: Scale): SongClip | null {
  const [x0, x1] = [Math.max(0, xOf(s, song.startMs)), Math.min(100, xOf(s, song.startMs + song.lengthMs))];
  if (x1 <= 0 || x0 >= NUMBER_CUT_X || x1 - x0 < 1) return null;
  const textLeft = Math.max(x0, NOW_X) + PAD_VW;
  const textRight = Math.min(x1 - PAD_VW, SAFE_RIGHT);
  const avail = textRight - textLeft;
  const bpm = song.bpm === undefined ? null : `${Math.round(song.bpm)} bpm`;
  const more = [song.artist, bpm].filter((t): t is string => t !== null && t.length > 0).join("  ");
  const titleW = widthVw(song.title.length, 3.1, s.aspect, TEXT_EM);
  const fits = avail >= titleW + widthVw(more.length + 2, 3.1, s.aspect, TEXT_EM);
  const moments = (song.moments ?? []).flatMap((m) => {
    const word = momentWord(m.kind);
    const x = xOf(s, song.startMs + m.at_ms);
    return word === null || x < NOW_X || x > SAFE_RIGHT ? [] : [{ x, word }];
  });
  const ticks: number[] = [];
  const anchors = song.anchors ?? [];
  if (anchors.length > 0) {
    for (let b = 0; b < 4000; b += PHRASE_BEATS) {
      const x = xOf(s, song.startMs + msAtBeat(anchors, b));
      if (x > x1) break;
      if (x >= x0 && x >= 0) ticks.push(x);
    }
  }
  return { key: `s${i}`, x0, x1, textLeft, textRight, title: song.title, detail: fits ? more : null, moments, ticks };
}

/** The class time the score is drawn for: whole seconds with reduced motion (it steps, it does not glide). */
export const scoreClock = (classMs: number, reduced: boolean): number => (reduced ? Math.floor(classMs / 1000) * 1000 : classMs);

export function scoreView(input: TextInput, narrow: boolean): ScoreView {
  const { cls, classMs, reducedMotion, aspect } = input;
  const ahead = aheadMinutes(narrow);
  const s: Scale = { now: scoreClock(classMs, reducedMotion), perMs: (100 - NOW_X) / (ahead * 60_000), aspect, narrow };
  const away = cls.score?.away ?? [];
  const intervals = (cls.score?.intervals ?? cls.intervals).flatMap((iv, i) => { const b = intervalBlock(cls, i, iv, s, away.includes(iv.startMs)); return b === null ? [] : [b]; });
  const songs = cls.songs.flatMap((song, i) => { const c = songClip(i, song, s); return c === null ? [] : [c]; });
  const endX = xOf(s, cls.endMs);
  return { nowX: NOW_X, aheadMin: ahead, intervals, songs, endX: endX > NOW_X && endX <= 100 ? endX : null };
}
