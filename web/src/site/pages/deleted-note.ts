// The note that follows a deletion (docs/design/site.md, "Classes", Deleted): the list shows it
// once, then it is gone. Kept in memory only, never in storage, and the selection is not kept.
let deleted: string | null = null;

/** Called when a class was deleted: the list shows the note the next time it is drawn. */
export function rememberDeleted(title: string | null): void {
  deleted = title ?? "";
}

/** The deleted class's title ("" when the page never knew it) for the note, once; null when nothing was deleted. */
export function takeDeleted(): string | null {
  const t = deleted;
  deleted = null;
  return t;
}
