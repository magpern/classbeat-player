// The fan's turn after a drop (scene.md "The flash budget" item 3, "Moment windows"): it starts at a fixed offset from the
// drop's moment alone, 2250 ms, so the drop's burst has ended 1 s before it whatever P1 merges (the drop's frame is under 1 s
// from the moment, the decay lasts 250 ms, plus 1 s). A drop less than 2.25 s before its song's end has no fan turn: its
// fixtures come on in its frame and the beams hold still until the song change's turn. The start depends on the song's moment
// and its length only: never on an interval change, the drop's frame or whether the burst is placed (rule 4, S7). Pure.

/** `TURN_DELAY_MS` stays the least delay of every moment's turn (650 ms); the fan's own is this much after the drop's moment. */
export const FAN_TURN_DELAY_MS = 2250;
/** The drop's fan window lasts at least this long (the fan is open within 5.75 s of the moment, 2.25 s plus the longest turn, 3.5 s, and for 1 s at any tempo). */
export const FAN_FLOOR_MS = 6750;
const FAN_BEATS = 16;

/** How long the drop's fan window lasts at `bpm`: 4 bars, and at least 6.75 s. */
export const fanWindowMs = (bpm: number): number => Math.max((FAN_BEATS * 60_000) / bpm, FAN_FLOOR_MS);

/**
 * Where the fan's turn starts, in the song's own time, for the drop at `dropMs`; null where there is none (a drop less than
 * 2.25 s before the song's end). `songLengthMs` unknown: the turn is there.
 */
export function fanTurnStartMs(dropMs: number, songLengthMs?: number): number | null {
  if (songLengthMs !== undefined && songLengthMs - dropMs < FAN_TURN_DELAY_MS) return null;
  return dropMs + FAN_TURN_DELAY_MS;
}
