// The one place the frame marks are placed (scene.md "The flash budget", text rule 2 and S14): from what the class says
// ahead (the interval changes, the song's drops, the countdown's seconds, the pattern count's beats) it builds the
// fixed frames (P1, merged) and every other mark (P2) with the model's `placeMarks`. The text layer's steps and the
// canvas's marks (`RunBudget`, `TextClock`) both read this one answer, so no two marks of either layer are less than
// 500 ms apart. With a count running the countdown's seconds are not marks of their own: they show on a count tick.
// Pure: the class and the time come in, nothing is read.

import type { BeatLevel, SceneClass } from "../../model/src/index.ts";
import { BEATS_PER_BAR, beatsAt, fixedFrames, patternCountRuns, placeMarks } from "../../model/src/index.ts";
import type { FixedFrame, Placed, Want } from "../../model/src/index.ts";
import { nth } from "./lookup.ts";
import { readPattern } from "./pattern-light-calc.ts";
import type { ScenePattern } from "./pattern-light-calc.ts";
import { msAtBeat } from "./text-score-calc.ts";

export const FRAME_MS = 1000 / 60;
/** How far around a moment the marks are gathered, ms. */
export const REACH_MS = 6000;
const SECOND_MS = 1000;
/** A count beat that cannot take a frame within a frame of its time is dropped, not moved: its value shows on the next tick (S14). */
const DROP_SLACK_MS = FRAME_MS + 1;
const MIN_SIDE_MS = 500;

export interface Where {
  readonly cls: SceneClass;
  readonly classMs: number;
  /** The current song's position, which fixes where its drops and beats fall on the class clock. */
  readonly songIndex: number;
  readonly songPosMs: number;
  readonly level: BeatLevel;
}

/** The intervals' change times and the song's drops within `reach` of `at`, on the class clock. */
export function nearby(w: Where, at: number, reach = REACH_MS): { changes: number[]; drops: number[] } {
  const near = (t: number) => Math.abs(t - at) <= reach;
  const changes = w.cls.intervals.map((iv) => iv.startMs).filter((t, i) => i > 0 && near(t));
  const song = nth(w.cls.songs, w.songIndex);
  const drops = (song?.moments ?? []).filter((m) => m.kind === "drop").map((m) => m.at_ms + w.classMs - w.songPosMs).filter(near);
  return { changes, drops };
}

const endOf = (cls: SceneClass, i: number): number => nth(cls.intervals, i + 1)?.startMs ?? cls.endMs;

/** The pattern of interval `i` when its count runs at this level (S14), else null. */
function countingPattern(w: Where, i: number): ScenePattern | null {
  const p = readPattern(nth(w.cls.intervals, i)?.pattern);
  const bpm = nth(w.cls.songs, w.songIndex)?.bpm;
  return p !== null && bpm !== undefined && bpm > 0 && patternCountRuns(w.level, p.startOn) ? p : null;
}

/** The countdown's seconds: a tick every second from an interval's start, in the intervals where no count runs. */
function countdownWants(w: Where, lo: number, hi: number): Want[] {
  return w.cls.intervals.flatMap((iv, i): Want[] => {
    const end = endOf(w.cls, i);
    if (end < lo || iv.startMs > hi || countingPattern(w, i) !== null) return [];
    const out: Want[] = [];
    for (let k = Math.max(1, Math.ceil((lo - iv.startMs) / SECOND_MS)); iv.startMs + k * SECOND_MS < end - 1e-6 && iv.startMs + k * SECOND_MS <= hi; k++) {
      out.push({ kind: "tick", atMs: iv.startMs + k * SECOND_MS, periodMs: SECOND_MS });
    }
    return out;
  });
}

/** Where the pattern's beats fall: the class time of counted beat `k` (0 at the first counted beat), and the position of a class time in counted beats (null: none). */
function beatClock(w: Where, i: number, p: ScenePattern): { timeOf: (k: number) => number; posAt: (t: number) => number | null } | null {
  const iv = nth(w.cls.intervals, i);
  const song = nth(w.cls.songs, w.songIndex);
  const bpm = song?.bpm;
  if (iv === undefined || bpm === undefined) return null;
  const off = w.classMs - w.songPosMs;
  if (w.level !== "Beat") return { timeOf: (k) => iv.startMs + (k * 60_000) / bpm, posAt: (t) => ((t - iv.startMs) * bpm) / 60_000 };
  const anchors = song?.anchors;
  const start = anchors === undefined ? null : beatsAt(anchors, iv.startMs - off);
  if (anchors === undefined || start === null) return null;
  const from = p.startOn === "next_downbeat" ? Math.ceil(start / BEATS_PER_BAR - 1e-9) * BEATS_PER_BAR : Math.floor(start);
  return { timeOf: (k) => msAtBeat(anchors, from + k) + off, posAt: (t) => { const b = beatsAt(anchors, t - off); return b === null ? null : b - from; } };
}

/**
 * The pattern count's beats (S14): the switch beat of each side is a tick of its own (late by up to a beat near a fixed
 * frame, then it joins one or is dropped), any other beat only where it is at least 500 ms before the next switch beat,
 * and it is dropped, never moved, where it is not at least 500 ms after the last mark. So up to 120 bpm the count steps on
 * every beat, and at 180 bpm with four-beat sides it shows the switch beat and the third beat of each side.
 */
function countWants(w: Where, lo: number, hi: number): Want[] {
  const bpm = nth(w.cls.songs, w.songIndex)?.bpm;
  if (bpm === undefined || !(bpm > 0)) return [];
  const beatMs = 60_000 / bpm;
  return w.cls.intervals.flatMap((iv, i): Want[] => {
    const p = countingPattern(w, i);
    const end = endOf(w.cls, i);
    if (p === null || end < lo || iv.startMs > hi) return [];
    const clock = beatClock(w, i, p);
    if (clock === null) return [];
    const [from, to] = [Math.max(lo, iv.startMs), Math.min(hi, end)];
    const [a, b] = [clock.posAt(from), clock.posAt(to)];
    if (a === null || b === null) return [];
    const cycle = p.beats.reduce((x, y) => x + y, 0);
    const starts = p.beats.map((_, j) => p.beats.slice(0, j).reduce((x, y) => x + y, 0));
    const out: Want[] = [];
    for (let k = Math.max(0, Math.floor(a) - 1); k <= Math.floor(b) + 1; k++) {
      const t = clock.timeOf(k);
      if (t < from || t >= to) continue;
      const r = k % cycle;
      if (starts.includes(r)) { out.push({ kind: "switch", atMs: t, periodMs: beatMs }); continue; }
      const toNext = (starts.find((s) => s > r) ?? cycle) - r;
      if (clock.timeOf(k + toNext) - t >= MIN_SIDE_MS) out.push({ kind: "tick", atMs: t, periodMs: DROP_SLACK_MS });
    }
    return out;
  });
}

export interface MarkPlan {
  readonly fixed: readonly FixedFrame[];
  readonly placed: readonly Placed[];
  /** Every frame a mark is on, in time order: the fixed frames and each mark placed, user actions included. */
  readonly marks: readonly number[];
}

/**
 * The marks within `reach` of `at`: P1 and P2 in one call. `actions` are the user actions not yet shown (a pause, a resume,
 * a seek) and `shown` the marks already on screen, which the others keep 500 ms from.
 */
export function planMarks(w: Where, at: number, reach = REACH_MS, extra: { readonly actions?: readonly Want[]; readonly shown?: readonly number[] } = {}): MarkPlan {
  const { changes, drops } = nearby(w, at, reach);
  const fixed = fixedFrames(changes, drops, FRAME_MS);
  const wants = [...countdownWants(w, at - reach, at + reach), ...countWants(w, at - reach, at + reach), ...(extra.actions ?? [])];
  const placed = placeMarks(fixed, wants, FRAME_MS, extra.shown ?? []);
  const marks = [...new Set([...fixed.map((f) => f.atMs), ...placed.flatMap((p) => (p.atMs === null ? [] : [p.atMs]))])].sort((x, y) => x - y);
  return { fixed, placed, marks };
}
