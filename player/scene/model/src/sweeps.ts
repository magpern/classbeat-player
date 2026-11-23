// The sweeps' planned windows and the cut a burst makes in one (scene.md "Steady light and sweeps", the scheduler's step a,
// "A burst cuts a sweep's window"). A sweep is any span in which a beam is held off its target by the turn-rate limiter; where
// the turn is foreseen (a function of the song's order, anchors, moments and length only: rule 4, S7) the scheduler plans its
// window from the turn's first frame for the full 4.15 s, since arrival can only end it sooner. A planned window never moves; a
// placed burst may only cut its length. Times are milliseconds on the class clock. Pure.

import { phraseFlipsMs } from "./beat-grid.ts";
import { fanTurnStartMs, fanWindowMs } from "./fan-turn.ts";
import type { SceneSong } from "./frame.ts";
import { TURN_DELAY_MS } from "./turn-moments.ts";

/** `--scene-sweep-window`: the longest turn, 3.5 s (`--scene-reaim`), plus `TURN_DELAY_MS`. */
export const SWEEP_WINDOW_MS = 4150;
/** A burst's decay keeps this much clear of a sweep's counted window, before it and after it. */
export const DECAY_CLEAR_MS = 1000;
/** The beams hold still this long before a drop: the gather's window ends there. */
export const HOLD_STILL_MS = 1000;
const BUILD_BEATS = 8;
const EPS = 1e-6;

export interface Window { readonly fromMs: number; readonly toMs: number }
export type SweepCause = "flip" | "song change" | "gather" | "gather end" | "fan" | "fan end";
export interface Sweep extends Window { readonly cause: SweepCause }

const sweep = (cause: SweepCause, fromMs: number, toMs = fromMs + SWEEP_WINDOW_MS): Sweep => ({ cause, fromMs, toMs });

/** The sweep a song change starts: the new song's look aims the beams at other targets from its first frame. */
export const songChangeSweep = (atMs: number): Sweep => sweep("song change", atMs);

/**
 * The windows of the song's foreseen sweeps that overlap `[fromMs, toMs]`, on the class clock: `startMs` is where the song
 * starts. A phrase flip (at every level: the plan is a function of the song, not of the link), a build's gather (to where the
 * beams hold still, 1 s before a drop), the turn from the gather to the fan, 2250 ms after the drop's moment, none for a drop
 * less than 2.25 s before the song's end, and the turns that leave a gather and a fan. A song change is `songChangeSweep`.
 */
export function songSweeps(song: SceneSong | undefined, startMs: number, fromMs: number, toMs: number): Sweep[] {
  if (song === undefined) return [];
  const at = (pos: number) => startMs + pos;
  const out: Sweep[] = phraseFlipsMs(song.anchors, fromMs - startMs - SWEEP_WINDOW_MS, toMs - startMs)
    .filter((t) => song.lengthMs === undefined || t < song.lengthMs)
    .map((t) => sweep("flip", at(t)));
  const bpm = song.bpm;
  if (bpm !== undefined && bpm > 0) {
    const beat = 60_000 / bpm;
    for (const m of song.moments ?? []) {
      if (m.kind === "drop") {
        const from = at(m.at_ms - BUILD_BEATS * beat + TURN_DELAY_MS);
        const to = Math.min(from + SWEEP_WINDOW_MS, at(m.at_ms - HOLD_STILL_MS));
        if (to > from + EPS) out.push(sweep("gather", from, to));
        const turn = fanTurnStartMs(m.at_ms, song.lengthMs);
        if (turn !== null) {
          out.push(sweep("fan", at(turn)));
          const end = at(m.at_ms + fanWindowMs(bpm) + TURN_DELAY_MS);
          if (song.lengthMs === undefined || end < at(song.lengthMs)) out.push(sweep("fan end", end));
        }
      } else if (m.kind === "build") {
        out.push(sweep("gather", at(m.at_ms + TURN_DELAY_MS)), sweep("gather end", at(m.at_ms + BUILD_BEATS * beat + TURN_DELAY_MS)));
      }
    }
  }
  return out.filter((s) => s.toMs > fromMs && s.fromMs < toMs).sort((a, b) => a.fromMs - b.fromMs);
}

/** A planned window against a placed decay. */
export type Cut =
  | { readonly kind: "clear" }
  /** The decay lies inside the window: the burst is skipped (steps e and f), the window is not cut. */
  | { readonly kind: "overlaps" }
  /** The window's length is cut to `counted` (null: nothing is left of it); its start, targets, direction and rate stay the song's. */
  | { readonly kind: "cut"; readonly counted: Window | null };

/**
 * A window that would end less than 1 s before the decay's first frame, or start less than 1 s after its last, is cut so it
 * ends at least 1 s before the first or starts at least 1 s after the last: the burst wins. Only the window's length changes.
 */
export function cutByDecay(w: Window, decay: Window): Cut {
  if (w.fromMs < decay.toMs - EPS && decay.fromMs < w.toMs - EPS) return { kind: "overlaps" };
  const before = decay.fromMs - w.toMs; // gap between the window's end and the decay's start
  const after = w.fromMs - decay.toMs;
  if (before >= -EPS && before < DECAY_CLEAR_MS - EPS) {
    const toMs = decay.fromMs - DECAY_CLEAR_MS;
    return { kind: "cut", counted: toMs > w.fromMs + EPS ? { fromMs: w.fromMs, toMs } : null };
  }
  if (after >= -EPS && after < DECAY_CLEAR_MS - EPS) {
    const fromMs = decay.toMs + DECAY_CLEAR_MS;
    return { kind: "cut", counted: fromMs < w.toMs - EPS ? { fromMs, toMs: w.toMs } : null };
  }
  return { kind: "clear" };
}
