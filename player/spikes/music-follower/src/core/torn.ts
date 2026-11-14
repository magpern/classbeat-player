// Torn-reading rule: one osascript read at a song change can mix two tracks (the old
// track's id with the new track's position and length). Pure: no I/O.
import { DURATION_TOLERANCE_MS, normalizeId } from "./match.js";
import type { Reading } from "./types.js";

function sameTrack(a: Reading, b: Reading): boolean {
  if (a.trackId && b.trackId) return normalizeId(a.trackId) === normalizeId(b.trackId);
  return a.title === b.title && a.artist === b.artist;
}

/**
 * Whether `r` looks torn against `prev` (the last reading that was applied): the same track
 * jumping back to within `seekMs` of its start while its length differs from the earlier
 * reading's length beyond the tolerance. A real seek to the start keeps the length.
 */
export function isTornReading(prev: Reading | null, r: Reading, nowMs: number, seekMs: number): boolean {
  if (!prev || !sameTrack(prev, r)) return false;
  if (r.positionMs > seekMs) return false;
  const prevPos = prev.state === "playing" ? prev.positionMs + Math.max(0, nowMs - prev.readAtMs) : prev.positionMs;
  if (prevPos - r.positionMs <= seekMs) return false; // not a jump backwards
  const a = prev.durationMs;
  const b = r.durationMs;
  if (a == null || b == null || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) > DURATION_TOLERANCE_MS;
}
