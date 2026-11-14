// The torn-reading rule. One read at a song change can mix two tracks: the old track's id and
// title with the new track's position and length (spike 1, owner's Mac, 2026-11-14). Pure: no I/O.
import { positionNow } from "../clock/music-link.ts";
import { normalizeId } from "./match.ts";
import type { LinkConfig, Observation } from "./types.ts";

function sameTrack(a: Observation, b: Observation): boolean {
  if (a.trackId && b.trackId) return normalizeId(a.trackId) === normalizeId(b.trackId);
  return a.title === b.title && a.artist === b.artist;
}

/**
 * Whether `obs` looks torn against `prev`, the last reading that was applied: the same track
 * jumping back to within `seekMs` of its start while its length differs from the earlier
 * reading's beyond the length tolerance. A real seek to the start keeps the length, so it is
 * never a torn reading and applies at once.
 */
export function isTornReading(prev: Observation | null, obs: Observation, now: number, cfg: Pick<LinkConfig, "seekMs" | "lengthToleranceMs">): boolean {
  if (prev === null || !sameTrack(prev, obs)) return false;
  if (obs.positionMs > cfg.seekMs) return false;
  if (positionNow(prev, now) - obs.positionMs <= cfg.seekMs) return false; // not a jump backwards
  const a = prev.lengthMs;
  const b = obs.lengthMs;
  if (a == null || b == null || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) > cfg.lengthToleranceMs;
}
