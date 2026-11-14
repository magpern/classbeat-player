// Match a reading to the class's songs. Pure: no I/O.
import type { Plan } from "./class_plan.js";
import type { Reading } from "./types.js";

export const DURATION_TOLERANCE_MS = 2500;

/** `spotify:track:ID` and `/com/spotify/track/ID` both become `ID`. */
export function normalizeId(id: string): string {
  const cut = Math.max(id.lastIndexOf(":"), id.lastIndexOf("/"));
  return cut >= 0 ? id.slice(cut + 1) : id;
}

export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function artistMatches(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
}

/** How a reading matched a class song (logged on the decision). */
export type MatchedBy =
  | "trackId"
  | "title_duration" // length equals the planned length
  | "title_duration_minus_crossfade" // macOS reports length minus the crossfade setting
  | "title_no_duration"; // the reading has no length

export interface MatchResult {
  indexes: number[];
  /** Distinct ways the candidates matched, joined with "+"; null when nothing matched. */
  matchedBy: string | null;
}

/**
 * Whether the reported length fits the planned one: equal to it, or to it minus the class
 * file's declared crossfade (macOS), each within the tolerance. A crossfade of 0 adds no case.
 */
export function durationMatch(
  reportedMs: number,
  plannedMs: number,
  crossfadeMs: number,
): "title_duration" | "title_duration_minus_crossfade" | null {
  if (Math.abs(reportedMs - plannedMs) <= DURATION_TOLERANCE_MS) return "title_duration";
  if (crossfadeMs > 0 && Math.abs(reportedMs - (plannedMs - crossfadeMs)) <= DURATION_TOLERANCE_MS) {
    return "title_duration_minus_crossfade";
  }
  return null;
}

/**
 * Class songs the reading could be, and how. Ids are used where the system gives them,
 * otherwise title and artist (and length when both sides know it), as plan section 4 says.
 */
export function matchDetail(plan: Plan, r: Reading): MatchResult {
  const none: MatchResult = { indexes: [], matchedBy: null };
  if (r.app && !/spotify/i.test(r.app)) return none; // another app is playing: not in the class
  if (r.trackId) {
    const id = normalizeId(r.trackId);
    const byId = plan.songs.filter((s) => s.trackId !== null && normalizeId(s.trackId) === id);
    if (byId.length > 0) return { indexes: byId.map((s) => s.index), matchedBy: "trackId" };
  }
  if (!r.title) return none;
  const hasLength = r.durationMs != null && r.durationMs > 0;
  const hits: { index: number; how: MatchedBy }[] = [];
  for (const s of plan.songs) {
    if (norm(s.title) !== norm(r.title) || !artistMatches(s.artist, r.artist)) continue;
    if (!hasLength) {
      hits.push({ index: s.index, how: "title_no_duration" });
      continue;
    }
    const how = durationMatch(r.durationMs as number, s.durationMs, plan.crossfadeMs);
    if (how) hits.push({ index: s.index, how });
  }
  if (hits.length === 0) return none;
  return { indexes: hits.map((h) => h.index), matchedBy: [...new Set(hits.map((h) => h.how))].join("+") };
}

/** Indexes of class songs the reading could be. */
export function matchCandidates(plan: Plan, r: Reading): number[] {
  return matchDetail(plan, r).indexes;
}
