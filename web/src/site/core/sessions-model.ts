// The Sessions page (docs/design/site.md, "Account"; ADR 0002, section 5): what `GET sessions`
// holds and the words of the page. Pure: no I/O. This browser is marked by a word in an outline,
// never by colour, and its button signs out; every other row's ends that session.
import { ID, ISO } from "./account-model.ts";

/** A signed-in browser as `GET sessions` gives it. Dates are the backend's ISO 8601 text. */
export interface SiteSession {
  readonly id: string;
  /** The browser family the backend read ("Firefox", "Other"): shown as it is, as text. */
  readonly browser: string;
  readonly startedAt: string;
  readonly lastUsedAt: string;
  /** The session of this browser. */
  readonly current: boolean;
}

const str = (v: unknown): v is string => typeof v === "string";

function sessionOf(x: unknown): SiteSession | null {
  if (typeof x !== "object" || x === null) return null;
  const s = x as Record<string, unknown>;
  if (!str(s.id) || !ID.test(s.id) || !str(s.browser) || !str(s.created_at) || !ISO.test(s.created_at) || !str(s.last_used_at) || !ISO.test(s.last_used_at) || typeof s.current !== "boolean") return null;
  return { id: s.id, browser: s.browser, startedAt: s.created_at, lastUsedAt: s.last_used_at, current: s.current };
}

/**
 * The sessions of an answer's body, in the backend's order (the most recently used first), or null
 * for a body the page does not understand. At most one is this browser's.
 */
export function sessionsOf(body: unknown): SiteSession[] | null {
  const list = typeof body === "object" && body !== null ? (body as { sessions?: unknown }).sessions : undefined;
  if (!Array.isArray(list)) return null;
  const out: SiteSession[] = [];
  for (const x of list) {
    const s = sessionOf(x);
    if (s === null) return null;
    out.push(s);
  }
  return out.filter((s) => s.current).length > 1 ? null : out;
}

/** The button of a row: this browser signs out, any other is ended. */
export const rowAction = (s: SiteSession): string => (s.current ? "Sign out" : "End session");

export const SESSION_WORDS = {
  heading: "Where you are signed in",
  intro: "Each browser you are signed in on. A session ends after 14 days without use.",
  thisBrowser: "This browser",
  started: (when: string): string => `Started ${when}`,
  endAll: "Sign out everywhere",
  endAllAsk: "Sign out everywhere?",
  endAllConsequence: "Every browser is signed out, this one too. Devices running the player stay paired.",
  cancel: "Cancel",
  ended: (browser: string): string => `Ended the session in ${browser}`,
  endedDetail: "That browser is signed out.",
} as const;
