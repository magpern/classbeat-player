// Reading the release feed's reply (ADR 0014, section 1). Pure: the main process fetches, caps
// the size and hands the text here. The answer is every player release in the reply, or "could
// not check"; never a partial result.
import { compareVersions, isPrerelease, parseVersion } from "./semver.ts";
import type { Version } from "./semver.ts";

/** The tag prefix of a player release (the release workflow, #760). */
export const TAG_PREFIX = "player-v";
/** The feed asks for one page of 100 (`per_page=100`); a longer reply is not the shape asked for. */
export const MAX_RELEASES = 100;

export interface Release {
  readonly version: Version;
  /** From the tag's hyphen part only; the API's `prerelease` flag is never read. */
  readonly prerelease: boolean;
}

export type FeedResult = { readonly ok: true; readonly releases: readonly Release[] } | { readonly ok: false };

const COULD_NOT_CHECK: FeedResult = { ok: false };

type Entry = { readonly tag: string; readonly published: boolean };

/**
 * One entry of the reply, or null when it has the wrong shape. Only the fields the rules need are
 * read; addresses, names, notes and assets in the reply are ignored and never reach the caller.
 */
function entryOf(raw: unknown): Entry | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const tag = r["tag_name"];
  const draft = r["draft"];
  const publishedAt = r["published_at"];
  if (typeof tag !== "string" || typeof draft !== "boolean") return null;
  if (publishedAt !== null && typeof publishedAt !== "string") return null;
  return { tag, published: !draft && typeof publishedAt === "string" && publishedAt !== "" };
}

/** The player version a tag names, or null for a foreign tag or one that is not `player-v<SemVer>`. */
export function versionOfTag(tag: string): Version | null {
  return tag.startsWith(TAG_PREFIX) ? parseVersion(tag.slice(TAG_PREFIX.length)) : null;
}

/**
 * The player releases in a feed reply's text, highest first. Drafts, unpublished releases, foreign
 * tags and tags that are not valid SemVer are left out. A reply that is not JSON, not an array, too
 * long, or has any entry of the wrong shape is "could not check" as a whole.
 */
export function readFeed(body: unknown): FeedResult {
  if (typeof body !== "string") return COULD_NOT_CHECK;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return COULD_NOT_CHECK;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_RELEASES) return COULD_NOT_CHECK;
  const releases: Release[] = [];
  for (const raw of parsed) {
    const entry = entryOf(raw);
    if (entry === null) return COULD_NOT_CHECK;
    if (!entry.published) continue;
    const version = versionOfTag(entry.tag);
    if (version !== null) releases.push({ version, prerelease: isPrerelease(version) });
  }
  releases.sort((a, b) => compareVersions(b.version, a.version));
  return { ok: true, releases };
}

/**
 * The highest release in the user's channel: stable only, or stable and pre-releases when the
 * "Pre-releases" setting is on. Null when the channel has none (with pre-releases off and no stable
 * release, the player is "up to date").
 */
export function latestIn(releases: readonly Release[], prereleases: boolean): Version | null {
  let best: Version | null = null;
  for (const r of releases) {
    if (r.prerelease && !prereleases) continue;
    if (best === null || compareVersions(r.version, best) > 0) best = r.version;
  }
  return best;
}
