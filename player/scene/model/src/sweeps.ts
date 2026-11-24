// The foreseen turns of a song (scene.md "Steady light and sweeps", the scheduler's step a): a sweep is any span in which a beam is held
// off its target by the turn-rate limiter; where the turn is foreseen (a function of the song's order, anchors, moments and length only:
// rule 4, S7) its first frame is known. `dark.ts` makes the spans the beams move in black over; a turn's part is at most 4.15 s from
// its first frame, the bound of the range a plan looks over. Times are milliseconds on the class clock. Pure.

import { phraseFlipsMs } from "./beat-grid.ts";
import { fanTurnStartMs, fanWindowMs } from "./fan-turn.ts";
import type { SceneSong } from "./frame.ts";
import { TURN_DELAY_MS } from "./turn-moments.ts";

/** `--scene-sweep-window`: the longest turn, 3.5 s (`--scene-reaim`), plus `TURN_DELAY_MS`. */
export const SWEEP_WINDOW_MS = 4150;
/** The beams hold still this long before a drop. */
export const HOLD_STILL_MS = 1000;
const BUILD_BEATS = 8;

export interface Window { readonly fromMs: number; readonly toMs: number }
export type SweepCause = "flip" | "song change" | "gather" | "gather end" | "fan" | "fan end";
export interface Sweep extends Window {
  readonly cause: SweepCause;
  /** A drop's gather: where the beams hold still, 1 s before the drop; the light is back by then ("never later than its hold-still"). */
  readonly holdStillMs?: number;
}

const sweep = (cause: SweepCause, fromMs: number, toMs = fromMs + SWEEP_WINDOW_MS): Sweep => ({ cause, fromMs, toMs });

/** The sweep a song change starts: the new song's look aims the beams at other targets from its first frame. */
export const songChangeSweep = (atMs: number): Sweep => sweep("song change", atMs);

/**
 * The first frames of the song's foreseen turns that overlap `[fromMs, toMs]`, on the class clock: `startMs` is where the song
 * starts. A phrase flip (at every level: the plan is a function of the song, not of the link), a build's gather, the turn from the gather to the fan, 2250 ms after the drop's moment, none for a drop
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
        out.push({ ...sweep("gather", from), holdStillMs: at(m.at_ms - HOLD_STILL_MS) });
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
