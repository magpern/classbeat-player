// Moving the selection in the class list with the keyboard (docs/design/class-list.md,
// "Keyboard"). Pure: ids in, an id out. Never moves a row, only the selection.
import { fold } from "./filter.ts";

export type Move = "up" | "down" | "home" | "end" | "pageup" | "pagedown";

/** The selection after a key; `page` is how many rows fit on a screenful. Null when there are no rows. */
export function moveSelection(ids: readonly string[], current: string | null, move: Move, page: number): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  const last = ids.length - 1;
  const step = Math.max(1, page - 1);
  const to = { up: at < 0 ? 0 : at - 1, down: at + 1, home: 0, end: last, pageup: at - step, pagedown: at + step }[move];
  return ids[Math.min(last, Math.max(0, to))] ?? null;
}

/** With fewer than eight classes: the next title (after the selected one, wrapping) that starts with the letter. */
export function jumpToLetter(rows: readonly { readonly id: string; readonly title: string }[], current: string | null, letter: string): string | null {
  const l = fold(letter);
  if (rows.length === 0 || l === "") return current;
  const at = rows.findIndex((r) => r.id === current);
  for (let i = 1; i <= rows.length; i++) {
    const r = rows[(at + i + rows.length) % rows.length];
    if (r !== undefined && fold(r.title).startsWith(l)) return r.id;
  }
  return current;
}

/**
 * The selection that stands after the rows changed: the class being played, else the same class
 * (by id) when still shown, else the class last started, else the first row.
 */
export function keepSelection(ids: readonly string[], selected: string | null, playing: string | null, lastStarted: string | null): string | null {
  if (playing !== null && ids.includes(playing)) return playing;
  if (selected !== null && ids.includes(selected)) return selected;
  if (lastStarted !== null && ids.includes(lastStarted)) return lastStarted;
  return ids[0] ?? null;
}
