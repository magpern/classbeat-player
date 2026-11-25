// The update status the user sees (ADR 0014, section 5) and the release page address (section 2).
// Pure. The address is built only from a version that passed the SemVer check and only when the
// status says "newer"; nothing from the feed or the renderer is ever part of it.
import { latestIn } from "./feed.ts";
import type { FeedResult } from "./feed.ts";
import { isNewer, parseVersion } from "./semver.ts";

export type UpdateKind = "up to date" | "newer" | "checking" | "could not check";

export interface UpdateStatus {
  readonly kind: UpdateKind;
  /** The running player's version. */
  readonly current: string;
  /** The highest version in the user's channel; null while checking, after a failed check, or when the channel is empty. */
  readonly latest: string | null;
}

/** Where every release page lives; only a checked version is appended. */
export const RELEASE_PAGE_PREFIX = "https://github.com/magpern/classbeat-player/releases/tag/player-v";

export function checking(current: string): UpdateStatus {
  return { kind: "checking", current, latest: null };
}

export function couldNotCheck(current: string): UpdateStatus {
  return { kind: "could not check", current, latest: null };
}

/**
 * The status after a check. "newer" only when the channel's highest version is strictly higher
 * than the running one; an equal or older one is "up to date". A running version that is not
 * SemVer can be compared with nothing, so it is "could not check" and offers nothing.
 */
export function statusAfter(current: string, feed: FeedResult, prereleases: boolean): UpdateStatus {
  const running = parseVersion(current);
  if (!feed.ok || running === null) return couldNotCheck(current);
  const latest = latestIn(feed.releases, prereleases);
  if (latest === null) return { kind: "up to date", current, latest: null };
  return { kind: isNewer(latest, running) ? "newer" : "up to date", current, latest: latest.text };
}

/**
 * The release page of the newer version, or null. Checked again here rather than trusted from
 * the status: the kind is "newer", both versions pass the SemVer check, and the latest is strictly
 * higher. SemVer allows only [0-9A-Za-z.+-], so no path, query or fragment can be smuggled in.
 */
export function releasePageAddress(status: UpdateStatus | null): string | null {
  if (status === null || status.kind !== "newer") return null;
  const latest = parseVersion(status.latest);
  const running = parseVersion(status.current);
  if (latest === null || running === null || !isNewer(latest, running)) return null;
  return RELEASE_PAGE_PREFIX + latest.text;
}
