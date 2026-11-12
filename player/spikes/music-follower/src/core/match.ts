// Match a reading to the class's songs. Pure: no I/O.
import type { Plan } from "./class_plan.js";
import type { Reading } from "./types.js";

const DURATION_TOLERANCE_MS = 2500;

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

/**
 * Indexes of class songs the reading could be. Ids are used where the system gives them,
 * otherwise title and artist (and length when both sides know it), as plan section 4 says.
 */
export function matchCandidates(plan: Plan, r: Reading): number[] {
  if (r.trackId) {
    const id = normalizeId(r.trackId);
    const byId = plan.songs.filter((s) => s.trackId !== null && normalizeId(s.trackId) === id);
    if (byId.length > 0) return byId.map((s) => s.index);
  }
  if (!r.title) return [];
  return plan.songs
    .filter((s) => {
      if (norm(s.title) !== norm(r.title) || !artistMatches(s.artist, r.artist)) return false;
      if (r.durationMs != null && r.durationMs > 0) return Math.abs(r.durationMs - s.durationMs) <= DURATION_TOLERANCE_MS;
      return true;
    })
    .map((s) => s.index);
}
