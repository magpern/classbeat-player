// The rows the class list shows (docs/design/class-list.md): the cached classes from sync, plus,
// while the class being played has lost its cached copy, the snapshot the shell took at Start.
// Pure. The order is the title's, A to Z without regard to case or accents, equal titles by id.
import type { ClassRow } from "../sync/class-list.ts";

/** A row of the list. `removed`: the cached copy is gone and the snapshot plays to the end. */
export interface ListRow extends ClassRow {
  readonly removed: boolean;
}

/** The fields of the pinned row kept in memory at Start; never written anywhere. */
export type RowSnapshot = Pick<ClassRow, "id" | "hash" | "title" | "lengthMs" | "sport" | "source" | "songs" | "updated">;

const titles = new Intl.Collator("en", { sensitivity: "base" });

export const byTitle = (a: Pick<ClassRow, "title" | "id">, b: Pick<ClassRow, "title" | "id">): number =>
  titles.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const snapshotOf = (r: ClassRow): RowSnapshot => ({ id: r.id, hash: r.hash, title: r.title, lengthMs: r.lengthMs, sport: r.sport, source: r.source, songs: r.songs, updated: r.updated });

/**
 * `pinned`: `SyncView.pinned`. While its `after` is "removed" the cached row is gone: the snapshot
 * stands in its own A to Z place. Otherwise the rows are the cached ones, with `removed: false`.
 */
export function listRows(rows: readonly ClassRow[], pinned: { readonly id: string; readonly after: string } | null, snapshot: RowSnapshot | null): readonly ListRow[] {
  const out: ListRow[] = rows.map((r) => ({ ...r, removed: false }));
  if (pinned !== null && pinned.after === "removed" && snapshot !== null && snapshot.id === pinned.id && !out.some((r) => r.id === pinned.id)) {
    out.push({ ...snapshot, playing: true, newer: false, notUpdated: false, removed: true });
    out.sort(byTitle);
  }
  return out;
}
