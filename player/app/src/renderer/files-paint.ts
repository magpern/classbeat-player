// Paints the instructor's music files state on the class list (docs/design/music-files.md): the
// files line and keys of a local class's footer, a row's files marker, the failure plate and the
// panel of the missing songs. Text only through textContent: a title, an artist and a file name come
// from the class document and never become markup (core/music-files/safe-text.ts already replaced
// control and bidi characters). Nothing here reads or shows a path.
import type { FilesLine, FilesList } from "../core/list/files-screen.ts";
import type { RowMix } from "../core/mix/list-model.ts";
import { buttonEl, h } from "./list-paint.ts";
import type { Act } from "./list-paint.ts";

/** The marker and words of a row's second line, in the style of the mix marker. */
export function rowFilesEl(f: RowMix): HTMLElement {
  const el = h("span", "mix manual");
  const mark = h("span", `mark ${f.marker}`);
  mark.setAttribute("aria-hidden", "true");
  el.append(mark, h("span", null, f.text));
  return el;
}

/** The files line under the footer's title: marker, words, "Show which files". */
export function filesLineEl(f: FilesLine, act: Act): HTMLElement {
  const line = h("div", "fline");
  const mark = h("span", `mark ${f.marker}`);
  mark.setAttribute("aria-hidden", "true");
  line.append(mark, h("span", "st", f.text));
  if (f.show !== null) line.append(buttonEl(f.show, act));
  return line;
}

/** Puts the new footer in place of the old; true when its height differs, so the list above it gives or takes room. */
export function swapFooter(body: HTMLElement, next: HTMLElement): boolean {
  const old = body.lastElementChild;
  const was = old?.getBoundingClientRect().height;
  old?.replaceWith(next);
  return was !== next.getBoundingClientRect().height;
}

/** The panel of the missing songs, in place of the list and the footer. */
export function filesPanelEl(p: FilesList, act: Act): HTMLElement {
  const box = h("section", "files-panel");
  box.dataset.panel = "files-list";
  const cols = h("div", "mcols");
  cols.setAttribute("aria-hidden", "true");
  cols.append(h("span", "lbl", "Song"), h("span", "lbl", "File name in the class"));
  const list = h("div", "mlist");
  list.tabIndex = 0;
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", p.heading);
  for (const s of p.songs) {
    const row = h("div", "mrow");
    row.setAttribute("role", "listitem");
    const song = h("div", null);
    song.append(h("div", "t", s.title), h("div", "m", s.artist));
    row.append(song, h("div", "f", s.fileName));
    list.append(row);
  }
  const keys = h("div", "row-btns");
  for (const b of p.buttons) keys.append(buttonEl(b, act));
  box.append(h("h2", "n", p.heading), h("p", null, p.sentence), cols, list, keys, h("p", "fine", p.fine));
  return box;
}
