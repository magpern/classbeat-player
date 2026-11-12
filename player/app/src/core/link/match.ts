// Matching a reading to the class's songs (ADR 0001: "Songs are matched by title, artist and
// length, in the class's order; provider ids are used only where the operating system gives
// them"). Pure. Returns every class song the reading could be: a recording that occurs twice
// gives two candidates, and choosing between them is choose.ts's job, never a silent guess here.
import type { LinkConfig, LinkPlan, Observation } from "./types.ts";

/** `spotify:track:ID`, `/com/spotify/track/ID` and an open.spotify.com link all become `ID`. */
export function normalizeId(id: string): string {
  const bare = id.split(/[?#]/, 1)[0];
  const cut = Math.max(bare.lastIndexOf(":"), bare.lastIndexOf("/"));
  return cut >= 0 ? bare.slice(cut + 1) : bare;
}

export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Whole-word containment either way, so "A" matches "A, B" and "A feat. B" but not "Abba". */
export function artistMatches(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === "" || y === "") return false;
  return ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
}

const isSpotify = (app: string): boolean => /spotify/i.test(app);

export function matchCandidates(plan: LinkPlan, obs: Observation, cfg: Pick<LinkConfig, "lengthToleranceMs">): number[] {
  // Another app playing is never part of the class.
  if (obs.app && !isSpotify(obs.app)) return [];
  if (obs.trackId) {
    const id = normalizeId(obs.trackId);
    const byId = plan.songs.filter((s) => s.trackIds.includes(id));
    if (byId.length > 0) return byId.map((s) => s.index);
  }
  const title = norm(obs.title);
  if (title === "") return [];
  const known = obs.lengthMs != null && obs.lengthMs > 0;
  return plan.songs
    .filter((s) => norm(s.title) === title && artistMatches(s.artist, obs.artist))
    .filter((s) => !known || Math.abs((obs.lengthMs as number) - s.lengthMs) <= cfg.lengthToleranceMs)
    .map((s) => s.index);
}
