// The rows of the class list (docs/design/class-list.md, "Data"): one per cached class, built
// field by field from the sync state and the cached documents, so that the window never holds a
// document, a token or an account key. Pure. The order is the title's, A to Z without regard to
// case or accents, equal titles by id: never by time, use or popularity (plan, rules 11 and 13).
import type { SyncState } from "./sync-model.ts";

export interface ClassRow {
  readonly id: string;
  /** The version the instructor sees: a start pins this one. */
  readonly hash: string;
  readonly title: string;
  readonly lengthMs: number;
  readonly sport: "cycling" | "running";
  /** "unknown": a music source this player does not know (a later minor of the format added it); the row says so and is not startable (ADR 0017 section 1). */
  readonly source: "spotify" | "swedebeat" | "none" | "local" | "unknown";
  readonly songs: number;
  /** When the server published this version (ISO 8601), or null when not known. */
  readonly updated: string | null;
  /** This class is the one being played. */
  readonly playing: boolean;
  /** Sync holds a newer version than the one being played; it applies after the class. */
  readonly newer: boolean;
  /** The server could not give a newer version; the older copy is shown. */
  readonly notUpdated: boolean;
}

/** The format major this player reads (the same as schema/ts/src/version.ts); a well-formed version of any other major needs a newer player. */
const KNOWN_MAJOR = 1;
const SOURCES: ReadonlySet<unknown> = new Set(["spotify", "swedebeat", "none", "local"]);
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const titles = new Intl.Collator("en", { sensitivity: "base" });

/** The displayed fields of a document; null when it has not the shape (a major this player does not know). */
function fields(doc: Readonly<Record<string, unknown>>): Pick<ClassRow, "title" | "lengthMs" | "sport" | "source" | "songs"> | null {
  const { class: cls, music, songs } = doc;
  if (!isObject(cls) || !isObject(music) || !Array.isArray(songs)) return null;
  const { title, length_ms: length, sport } = cls;
  if (typeof title !== "string" || typeof length !== "number" || !Number.isFinite(length) || length < 0) return null;
  if (sport !== "cycling" && sport !== "running") return null;
  const kind = music.source;
  if (typeof kind !== "string" || kind === "") return null;
  return { title, lengthMs: length, sport, source: SOURCES.has(kind) ? (kind as ClassRow["source"]) : "unknown", songs: songs.length };
}

/** A document of a format major this player does not know (ADR 0003 section 7): its shape is not read. The row keeps what is plainly there, a title and a length, and is "unknown" like an unknown music source, so it is listed, says it needs a newer player and never starts. */
function newerMajor(doc: Readonly<Record<string, unknown>>): Pick<ClassRow, "title" | "lengthMs" | "sport" | "source" | "songs"> | null {
  const major = typeof doc.format_version === "string" && /^\d+\.\d+$/.test(doc.format_version) ? Number(doc.format_version.split(".")[0]) : undefined;
  if (major === undefined || major === KNOWN_MAJOR) return null;
  const cls = isObject(doc.class) ? doc.class : {};
  const length = cls.length_ms;
  return {
    title: typeof cls.title === "string" && cls.title !== "" ? cls.title : "Untitled class",
    lengthMs: typeof length === "number" && Number.isFinite(length) && length >= 0 ? length : 0,
    sport: cls.sport === "running" ? "running" : "cycling",
    source: "unknown",
    songs: 0,
  };
}

/** `documents`: the cached documents by class id; a class with none that reads as a class has no row. */
export function classListView(s: SyncState, documents: ReadonlyMap<string, Readonly<Record<string, unknown>>>): readonly ClassRow[] {
  const rows: ClassRow[] = [];
  for (const [id, hash] of s.held) {
    const doc = documents.get(id);
    const f = doc === undefined ? null : (newerMajor(doc) ?? fields(doc));
    if (f === null) continue;
    const playing = s.pinned?.id === id;
    rows.push({ id, hash, ...f, updated: s.published.get(id) ?? null, playing, newer: playing && s.pinned?.hash !== hash, notUpdated: s.notUpdated.has(id) });
  }
  return rows.sort((a, b) => titles.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
