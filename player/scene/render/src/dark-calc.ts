// The dark spans of the song the rig is in (scene.md "A sweep moves in black"): from the song's foreseen turns (its phrase flips, its builds and
// drops, its song changes) and the angle each turn has to cover, the pure model's own, it plans the spans the beams move in black over: the
// off-step on a turn's first frame, the on-step at the later of the arrival and 1 s + 1 frame after it, near turns joined. The plan is the song's
// alone, as planned without any burst, so no direction depends on it (rule 4); the loop (dark-gate.ts) lights and darkens the beams by it and the
// scheduler (budget-calc.ts) keeps every run out of it. Pure: the class and the time come in, nothing is read.

import type { DarkSpan, Direction, Sweep, Turn } from "../../model/src/index.ts";
import { MAX_DEG_PER_SECOND, angleBetween, planSpans, sceneFrame, songChangeSweep, songSweeps } from "../../model/src/index.ts";
import type { SceneClass } from "../../model/src/index.ts";
import { FRAME_MS, REACH_MS } from "./marks-calc.ts";
import { nth } from "./lookup.ts";

/** The longest turn: 105 degrees at 30 degrees a second. */
export const LONGEST_TURN_MS = 3500;
const LOCKED = { state: "Locked" } as const;

/** The targets of a song at a position, at the Beat level and with the motion phase at 0 (the plan's own, nominal, phase). */
function targets(cls: SceneClass, songIndex: number, posMs: number): readonly Direction[] {
  return sceneFrame({ cls, classMs: 0, songIndex, songPosMs: posMs, phaseDeg: 0, link: LOCKED }).directions;
}

/** How long the beams need to turn from `before` to `after` at the limiter's rate, the longest of the 22, at most the longest turn. */
export function turnMs(before: readonly Direction[], after: readonly Direction[]): number {
  const angle = Math.max(0, ...after.map((a, i) => angleBetween(nth(before, i) ?? a, a)));
  return Math.min(LONGEST_TURN_MS, (angle / MAX_DEG_PER_SECOND) * 1000);
}

export interface SongAt {
  readonly cls: SceneClass;
  readonly songIndex: number;
  /** The song's position at `classMs`: its start on the class clock is `classMs - songPosMs`. */
  readonly songPosMs: number;
  readonly classMs: number;
}

/** The turns of the song the rig is in, within `reach` of the moment, each with the arrival the pure model gives it. */
export function songTurns(w: SongAt, reach = REACH_MS): Turn[] {
  const song = nth(w.cls.songs, w.songIndex);
  const offset = w.classMs - w.songPosMs; // where the song starts, on the class clock
  const [lo, hi] = [w.classMs - reach, w.classMs + reach];
  const next = nth(w.cls.songs, w.songIndex + 1);
  const prev = nth(w.cls.songs, w.songIndex - 1);
  const turn = (s: Sweep, from: readonly Direction[], to: readonly Direction[], capMs?: number): Turn => ({ startMs: s.fromMs, arrivalMs: s.fromMs + turnMs(from, to), ...(capMs === undefined ? {} : { capMs }) });
  const holdStill = (s: Sweep): number | undefined => (s.cause === "gather" ? s.holdStillMs : undefined);
  const own = songSweeps(song, offset, lo, hi).map((s) => turn(s, targets(w.cls, w.songIndex, s.fromMs - offset - 1), targets(w.cls, w.songIndex, s.fromMs - offset), holdStill(s)));
  const into = w.songIndex > 0 && prev !== undefined ? [turn(songChangeSweep(offset), targets(w.cls, w.songIndex - 1, prev.lengthMs ?? 0), targets(w.cls, w.songIndex, 0))] : [];
  const out = next !== undefined && song?.lengthMs !== undefined ? [turn(songChangeSweep(offset + song.lengthMs), targets(w.cls, w.songIndex, song.lengthMs), targets(w.cls, w.songIndex + 1, 0))] : [];
  return [...own, ...into, ...out].filter((t) => t.arrivalMs > lo && t.startMs < hi);
}

/** The planned dark spans around the moment: the song's turns, joined. */
export const songSpans = (w: SongAt, reach = REACH_MS): DarkSpan[] => planSpans(songTurns(w, reach), FRAME_MS);
