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
  readonly source: "spotify" | "swedebeat" | "none";
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

const SOURCES: ReadonlySet<unknown> = new Set(["spotify", "swedebeat", "none"]);
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const titles = new Intl.Collator("en", { sensitivity: "base" });

/** The displayed fields of a document; null when it has not the shape (a major this player does not know). */
function fields(doc: Readonly<Record<string, unknown>>): Pick<ClassRow, "title" | "lengthMs" | "sport" | "source" | "songs"> | null {
  const { class: cls, music, songs } = doc;
  if (!isObject(cls) || !isObject(music) || !Array.isArray(songs)) return null;
  const { title, length_ms: length, sport } = cls;
  if (typeof title !== "string" || typeof length !== "number" || !Number.isFinite(length) || length < 0) return null;
  if (sport !== "cycling" && sport !== "running") return null;
  if (!SOURCES.has(music.source)) return null;
  return { title, lengthMs: length, sport, source: music.source as ClassRow["source"], songs: songs.length };
}

/** `documents`: the cached documents by class id; a class with none that reads as a class has no row. */
export function classListView(s: SyncState, documents: ReadonlyMap<string, Readonly<Record<string, unknown>>>): readonly ClassRow[] {
  const rows: ClassRow[] = [];
  for (const [id, hash] of s.held) {
    const doc = documents.get(id);
    const f = doc === undefined ? null : fields(doc);
    if (f === null) continue;
    const playing = s.pinned?.id === id;
    rows.push({ id, hash, ...f, updated: s.published.get(id) ?? null, playing, newer: playing && s.pinned?.hash !== hash, notUpdated: s.notUpdated.has(id) });
  }
  return rows.sort((a, b) => titles.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
