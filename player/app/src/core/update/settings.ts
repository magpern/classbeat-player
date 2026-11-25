// The update settings (ADR 0014, sections 1 and 5; docs/design/updates.md). Pure. They live in the
// main process's settings file only: the renderer sets the two switches through their boolean
// setters and never reads or sets the feed address.
import { DEFAULT_FEED, parseFeedAddress } from "./feed-address.ts";

export interface UpdateSettings {
  /** "Check automatically": at start and every 6 hours. On by default. */
  readonly auto: boolean;
  /** "Pre-releases": test versions count as newer. Off by default. */
  readonly prereleases: boolean;
  /** The feed address override as written in the file; null is the default feed. Kept as written so a setter never loses it. */
  readonly feed: string | null;
}

export const DEFAULT_SETTINGS: UpdateSettings = { auto: true, prereleases: false, feed: null };

/**
 * The settings in a file's text. A missing or unreadable file, or one that is not a JSON object,
 * gives the defaults; a value of the wrong type gives that value's default. A feed override that is
 * there but not a string is kept as an empty string, which no fetch accepts (fail closed).
 */
export function readSettings(text: string | null): UpdateSettings {
  if (text === null) return DEFAULT_SETTINGS;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return DEFAULT_SETTINGS;
  const r = raw as Record<string, unknown>;
  const auto = r["automaticChecks"];
  const prereleases = r["prereleases"];
  const feed = r["feed"];
  return {
    auto: typeof auto === "boolean" ? auto : DEFAULT_SETTINGS.auto,
    prereleases: typeof prereleases === "boolean" ? prereleases : DEFAULT_SETTINGS.prereleases,
    feed: feed === undefined || feed === null ? null : typeof feed === "string" ? feed : "",
  };
}

/** The file's text for these settings. */
export function writeSettings(s: UpdateSettings): string {
  const out: Record<string, unknown> = { automaticChecks: s.auto, prereleases: s.prereleases };
  if (s.feed !== null) out["feed"] = s.feed;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The address to fetch: the default, or the override when it is a valid `https:` address; null when the override is not. */
export function feedOf(s: UpdateSettings): string | null {
  return s.feed === null ? DEFAULT_FEED : parseFeedAddress(s.feed);
}
