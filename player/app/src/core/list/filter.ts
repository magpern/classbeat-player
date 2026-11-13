// The class list's filter (docs/design/class-list.md): a "contains" on the title that folds case
// and accents the way the sort does (the sort's collator has base sensitivity). Pure.
import type { ListRow } from "./rows.ts";

/** The filter appears from this many classes. */
export const FILTER_FROM = 8;

/** Lower case, accents and other combining marks removed. */
export const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The rows whose title contains the text; all of them for an empty (or blank) text. */
export function filterRows(rows: readonly ListRow[], text: string): readonly ListRow[] {
  const needle = fold(text.trim());
  return needle === "" ? rows : rows.filter((r) => fold(r.title).includes(needle));
}
