// Account: Linked apps (docs/design/site.md, "Account"; ADR 0002, section 7): what
// `GET source-links` holds and the words of the page. Pure: no I/O. An app's name is the
// backend's text, shown as it is.
import { ID, ISO } from "./account-model.ts";

/** At most 5 links per account (ADR 0002, section 7). */
export const LINK_MAX = 5;

/** A linked app as `GET source-links` gives it. Dates are the backend's ISO 8601 text. */
export interface SourceLink {
  readonly id: string;
  /** The display name of the source, from the backend's setting. */
  readonly name: string;
  readonly linkedAt: string;
  readonly lastUsedAt: string | null;
}

const str = (v: unknown): v is string => typeof v === "string";

function linkOf(x: unknown): SourceLink | null {
  if (typeof x !== "object" || x === null) return null;
  const l = x as Record<string, unknown>;
  const last = l.last_used_at;
  if (!str(l.id) || !ID.test(l.id) || !str(l.source) || !str(l.name) || l.name.trim() === "" || !str(l.linked_at) || !ISO.test(l.linked_at)) return null;
  if (last !== null && !(str(last) && ISO.test(last))) return null;
  return { id: l.id, name: l.name, linkedAt: l.linked_at, lastUsedAt: last };
}

/** The links of an answer's body, in the backend's order, or null for a body the page does not understand. */
export function linksOf(body: unknown): SourceLink[] | null {
  const list = typeof body === "object" && body !== null ? (body as { source_links?: unknown }).source_links : undefined;
  if (!Array.isArray(list)) return null;
  const out: SourceLink[] = [];
  for (const x of list) {
    const l = linkOf(x);
    if (l === null) return null;
    out.push(l);
  }
  return out;
}

export const linkCountWords = (n: number): string => `${n} of ${LINK_MAX} apps`;

export const LINK_WORDS = {
  heading: "Linked apps",
  intro: "An app you link can send classes to your account and remove the ones it sent. It sees nothing else.",
  none: "No apps are linked. In classbeat, choose Connect player. You are sent here to approve it.",
  linked: (when: string): string => `Linked ${when}`,
  revoke: "Revoke",
  ask: (name: string): string => `Revoke “${name}”?`,
  consequence: "It can no longer send classes. The classes already in your library stay.",
  keep: "Keep it",
  revokeApp: "Revoke app",
  done: (name: string): string => `Revoked “${name}”`,
  doneDetail: "The classes it sent stay in your library.",
} as const;
