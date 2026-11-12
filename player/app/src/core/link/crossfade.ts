// Measuring the real crossfade at a song change (ADR 0001 rules 6 and 7). Pure.
import { positionNow } from "../clock/music-link.ts";
import type { LinkSong, Observation } from "./types.ts";

/** The new song must have been seen this soon after it started, or its start moment is unsure. */
const MAX_ARRIVAL_MS = 10_000;
/** The outgoing song's last reading must be this recent at the moment the new song started. */
const MAX_PREVIOUS_AGE_MS = 10_000;
const MAX_CROSSFADE_MS = 30_000;

/**
 * How long the two songs overlapped: the outgoing song's length minus where it was when the
 * incoming song started. Crossfade off gives 0. Null when the readings cannot tell.
 */
export function measureCrossfade(outgoing: LinkSong, prev: Observation, incoming: Observation): number | null {
  if (!prev.playing || !incoming.playing || incoming.positionMs > MAX_ARRIVAL_MS) return null;
  const startedAt = incoming.at - incoming.positionMs;
  if (startedAt < prev.at || startedAt - prev.at > MAX_PREVIOUS_AGE_MS) return null;
  const x = outgoing.lengthMs - positionNow(prev, startedAt);
  if (x < -1500 || x > MAX_CROSSFADE_MS) return null;
  return Math.round(Math.max(0, x));
}
