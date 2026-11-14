// The torn-reading rule. One read at a song change can mix two tracks: the old track's id and
// title with the new track's position and length (spike 1, owner's Mac, 2026-11-14). Pure: no I/O.
import { positionNow } from "../clock/music-link.ts";
import { artistMatches, normalizeId, norm } from "./match.ts";
import type { LinkConfig, LinkModel, Observation } from "./types.ts";

type TornConfig = Pick<LinkConfig, "seekMs" | "lengthToleranceMs" | "staleMs">;

/** What a command or a lost reading does to the rule: nothing is remembered. */
export const NO_TORN = { applied: null, tornHeld: null } as const satisfies Pick<LinkModel, "applied" | "tornHeld">;

function sameTrack(a: Observation, b: Observation): boolean {
  if (a.trackId && b.trackId) return normalizeId(a.trackId) === normalizeId(b.trackId);
  return norm(a.title) === norm(b.title) && artistMatches(a.artist, b.artist);
}

/** The same reading delivered again (the shell steps every 100 ms, readers poll every 250 ms). */
const sameReading = (a: Observation, b: Observation): boolean => a.at === b.at && a.positionMs === b.positionMs && a.lengthMs === b.lengthMs && a.playing === b.playing;

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

/**
 * "hold": a torn reading, first seen. "keep": the same torn reading again, still held. "apply":
 * anything else, so a different reading, even an inconsistent one, decides (no endless hold),
 * and a hold lasts no longer than the staleness limit.
 */
export function tornDecision(prev: Observation | null, held: LinkModel["tornHeld"], obs: Observation, now: number, cfg: TornConfig): "hold" | "keep" | "apply" {
  if (!isTornReading(prev, obs, now, cfg)) return "apply";
  if (held === null) return "hold";
  return sameReading(held.obs, obs) && now - held.since <= cfg.staleMs ? "keep" : "apply";
}
