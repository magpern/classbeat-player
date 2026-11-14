// The devices page (docs/design/site.md, "Devices and pairing"; ADR 0002, section 6): what
// `GET devices` holds, the words of a row and what a revoke's answer means. Pure: no I/O. The
// page's own clock and time zone are read at the edge and come in as calendar days.
import type { Answer } from "./answer.ts";

/** A device as `GET devices` gives it. Dates are the backend's ISO 8601 text. */
export interface Device {
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly version: string;
  readonly pairedAt: string;
  readonly lastUsedAt: string | null;
}

/** The id goes into `DELETE devices/{id}`: only a canonical lower-case uuid is taken. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const str = (v: unknown): v is string => typeof v === "string";

function deviceOf(x: unknown): Device | null {
  if (typeof x !== "object" || x === null) return null;
  const d = x as Record<string, unknown>;
  const last = d.last_used_at;
  if (!str(d.id) || !ID.test(d.id) || !str(d.name) || !str(d.platform) || !str(d.version) || !str(d.paired_at) || !ISO.test(d.paired_at)) return null;
  if (last !== null && !(str(last) && ISO.test(last))) return null;
  return { id: d.id, name: d.name, platform: d.platform, version: d.version, pairedAt: d.paired_at, lastUsedAt: last };
}

/** The devices of an answer's body, in the backend's order (the most recently paired first), or null for a body the page does not understand. */
export function devicesOf(body: unknown): Device[] | null {
  const list = typeof body === "object" && body !== null ? (body as { devices?: unknown }).devices : undefined;
  if (!Array.isArray(list)) return null;
  const out: Device[] = [];
  for (const x of list) {
    const d = deviceOf(x);
    if (d === null) return null;
    out.push(d);
  }
  return out;
}

export const countWords = (n: number): string => (n === 1 ? "1 device" : `${n} devices`);

/** A calendar day in the page's own time zone; `month` is 1 to 12. */
export interface Day {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "today", "3 Nov", or "3 Nov 2025" for another year. */
export function dayWords(at: Day, today: Day): string {
  if (at.year === today.year && at.month === today.month && at.day === today.day) return "today";
  const date = `${at.day} ${MONTHS[at.month - 1] ?? ""}`;
  return at.year === today.year ? date : `${date} ${at.year}`;
}

/** The platform and version, as the app sent them. */
export const platformWords = (d: Device): string => `${d.platform}, version ${d.version}`;
export const pairedWords = (at: Day, today: Day): string => `Paired ${dayWords(at, today)}`;
export const lastUsedWords = (at: Day | null, today: Day): string => (at === null ? "Not used yet" : `Last used ${dayWords(at, today)}`);

export type DevicePlate = { readonly kind: "too-many"; readonly retryAfter: number | null } | { readonly kind: "offline" } | { readonly kind: "server" };

/**
 * After `DELETE devices/{id}`: revoked (204), already gone (404: the list is read again), the
 * session ended, or a plate; the confirmation stays open under a plate.
 */
export function revokeOutcome(a: Answer): "revoked" | "gone" | "ended" | DevicePlate {
  if (a.kind === "ok") return "revoked";
  if (a.kind === "not_signed_in") return "ended";
  if (a.kind === "refused" && a.status === 404) return "gone";
  if (a.kind === "too_many") return { kind: "too-many", retryAfter: a.retryAfter };
  return a.kind === "offline" ? { kind: "offline" } : { kind: "server" };
}

export const REVOKE_WORDS = {
  ask: (name: string): string => `Revoke “${name}”?`,
  consequence: "It stops getting classes at once. The classes saved on it are removed the next time it connects.",
  done: (name: string): string => `Revoked “${name}”`,
  doneDetail: "The classes saved on it are removed the next time it connects.",
} as const;
