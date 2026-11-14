// The class picker's rows (docs/design/play.md, "The picker"; site.md, "Classes"). Pure: an answer
// of `GET /api/site/classes` in, rows out. Title A to Z, case and accents ignored, equal titles by
// id: never by date or use (rules 10 and 13). Removal markers carry no title and are not shown.
import { clockText } from "../room/format.ts";
import { classIdOf } from "./route.ts";

export interface Row {
  readonly id: string;
  readonly title: string;
  readonly lengthMs: number;
  readonly source: string;
  readonly changedAt: string;
}

/** A page of the route: the entries, and the cursor of the next page when there is one. */
export interface Page {
  readonly rows: readonly Row[];
  readonly next: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One page of `GET classes`; null when the answer is not the route's shape. */
export function pageOf(body: unknown): Page | null {
  if (!isRecord(body) || !Array.isArray(body.classes)) return null;
  const rows: Row[] = [];
  for (const e of body.classes) {
    if (!isRecord(e) || e.removed === true) continue;
    if (typeof e.class_id !== "string" || typeof e.title !== "string" || typeof e.length_ms !== "number" || typeof e.changed_at !== "string") return null;
    // A class the page could not open from its address (an id that is not a canonical UUID) is not offered.
    if (classIdOf(`#${e.class_id}`) === null) continue;
    rows.push({ id: e.class_id, title: e.title, lengthMs: e.length_ms, source: typeof e.source === "string" ? e.source : "", changedAt: e.changed_at });
  }
  const next = body.more === true && typeof body.cursor === "string" && body.cursor !== "" ? body.cursor : null;
  return { rows, next };
}

/** A title as sorted and searched: accents and case ignored. */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Title A to Z, equal titles by id. */
export function sorted(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const x = fold(a.title);
    const y = fold(b.title);
    return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The rows whose title holds the typed text, in the same order. */
export function filtered(rows: readonly Row[], typed: string): readonly Row[] {
  const q = fold(typed.trim());
  return q === "" ? rows : rows.filter((r) => fold(r.title).includes(q));
}

/** The filter shows from this many classes. */
export const FILTER_FROM = 8;

/** The count beside the heading: "1 class", "12 classes". */
export const countText = (n: number): string => `${n} ${n === 1 ? "class" : "classes"}`;

export const lengthText = (ms: number): string => clockText(ms);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Yesterday", "2 Aug", or "14 Dec 2025" from another year. */
export function changedText(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date): number => Math.floor(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86_400_000);
  const ago = day(now) - day(d);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}
