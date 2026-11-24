// The moments as they steer the beams' turn (scene.md "How a beam turns", "The fan's turn follows the drop"): the song's moments
// delayed by `TURN_DELAY_MS`, except the drop's fan, which turns 2250 ms after the drop's moment and not at all for a drop
// less than 2.25 s before its song's end. Between the drop and the fan's turn (or to the song's end, with no turn) the beams
// hold the gather's aim. A function of the song's moments, its tempo and its length and of the position only (rule 4, S7). Pure.

import { fanTurnStartMs, fanWindowMs } from "./fan-turn.ts";
import { momentsAt } from "./moments.ts";
import type { Moments, SongMoment } from "./moments.ts";

/** The beams' turn follows the song's moments this long after them (a function of the moments only, rule 4). */
export const TURN_DELAY_MS = 650;

export function turningMoments(items: readonly SongMoment[] | undefined, bpm: number | undefined, posMs: number, songLengthMs?: number): Moments {
  const base = momentsAt(items, bpm, posMs - TURN_DELAY_MS);
  if (!items || bpm === undefined || !(bpm > 0)) return base;
  let gather = base.gather;
  let fan = false;
  for (const m of items) {
    if (m.kind !== "drop") continue;
    const turn = fanTurnStartMs(m.at_ms, songLengthMs);
    fan ||= turn !== null && posMs >= turn && posMs - TURN_DELAY_MS < m.at_ms + fanWindowMs(bpm);
    // The gather's aim is held from the drop until the fan's turn, or for good where there is none.
    gather ||= posMs - TURN_DELAY_MS >= m.at_ms && (turn === null || posMs < turn);
  }
  return { gather, fan: fan && !gather, breakdown: base.breakdown };
}
