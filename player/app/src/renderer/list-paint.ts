// Paints the class list's `Screen` (core/list/screen.ts) into the page. Text only through
// textContent; nothing from a class becomes markup. Each region is rebuilt only when what it shows
// changed, so a poll that finds nothing new touches nothing (and never moves the focus or the
// scroll position).
import type { Footer, RowModel } from "../core/list/screen.ts";
import type { Panel, Plate, StatusLine } from "../core/list/states.ts";
import { filesLineEl, rowFilesEl } from "./files-paint.ts";
import { buttonEl, h, shortcut } from "./paint-base.ts";
import type { Act } from "./paint-base.ts";

export { buttonEl, h, shortcut };
export type { Act };

export function statusEl(s: StatusLine): HTMLElement {
  const box = h("div", "status");
  const what = h("div", "what");
  const mark = h("span", `mark ${s.marker}`);
  mark.setAttribute("aria-hidden", "true");
  const words = h("div", null);
  words.append(h("span", "st", s.text));
  if (s.detail !== null) words.append(h("span", "dt", s.detail));
  what.append(mark, words);
  box.append(what);
  return box;
}

export function plateEl(p: Plate, act: Act, role: "status" | "alert" | null, second: boolean): HTMLElement {
  const box = h("div", second ? "plate second" : "plate");
  if (role === "alert") box.setAttribute("role", "alert");
  const words = h("div", null);
  words.append(h("span", "st", p.headline));
  if (p.detail !== null) words.append(h("span", "dt", p.detail));
  if (p.lines.length > 0) {
    const ul = h("ul", null);
    for (const l of p.lines) ul.append(h("li", null, l));
    words.append(ul);
  }
  box.append(words);
  if (p.button !== null) box.append(buttonEl(p.button, act));
  return box;
}

export function panelEl(p: Panel, act: Act): HTMLElement {
  const box = h("section", "panel");
  box.dataset.panel = p.kind;
  if (p.label !== null) box.append(h("span", "lbl", p.label));
  if (p.code !== null) box.append(h("span", "code", p.code));
  if (p.heading !== "") box.append(h("h2", "n", p.heading));
  if (p.text !== null) box.append(h("p", null, p.text));
  if (p.steps.length > 0) {
    const ol = h("ol", "steps");
    for (const s of p.steps) {
      const li = h("li", null);
      li.append(h("span", null, s.text));
      if (s.url !== null) li.append(" ", h("span", "url", s.url));
      ol.append(li);
    }
    box.append(ol);
  }
  if (p.note !== null) box.append(h("span", "left", p.note));
  if (p.buttons.length > 0) {
    const row = h("div", "row-btns");
    for (const b of p.buttons) row.append(buttonEl(b, act));
    box.append(row);
  }
  return box;
}

export function rowEl(r: RowModel, select: (id: string) => void): HTMLElement {
  const row = h("div", `row${r.selected ? " sel" : ""}${r.dim ? " off" : ""}`);
  row.id = `row-${r.id}`;
  row.dataset.id = r.id;
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", String(r.selected));
  const main = h("div", null);
  main.append(h("div", "t", r.title));
  const meta = h("div", "m", "");
  meta.append(h("span", null, r.meta));
  if (r.mix !== null) {
    // The mix's state on a Swedebeat row (docs/design/swedebeat.md): a marker and its words.
    const mix = h("span", "mix manual");
    const mark = h("span", `mark ${r.mix.marker}`);
    mark.setAttribute("aria-hidden", "true");
    mix.append(mark, h("span", null, r.mix.text));
    meta.append(mix);
  }
  // A local row's files marker and words (docs/design/music-files.md).
  if (r.files !== null) meta.append(rowFilesEl(r.files));
  for (const t of r.tags) meta.append(h("span", "tag", t));
  main.append(meta);
  row.append(main, h("span", "len", r.length), h("span", "upd", r.updated ?? ""));
  row.addEventListener("click", () => select(r.id));
  return row;
}

export function colsEl(): HTMLElement {
  const cols = h("div", "cols");
  cols.setAttribute("aria-hidden", "true");
  cols.append(h("span", "lbl", "Class"), h("span", "lbl", "Length"), h("span", "lbl", "Updated"));
  return cols;
}

export function footerEl(f: Footer, act: () => void, keys: Act): HTMLElement {
  const foot = h("footer", f.files === null ? "foot" : "foot files");
  const sel = h("div", "sel");
  const t = h("div", "t");
  t.append(h("span", null, f.title));
  sel.append(t);
  if (f.files !== null) sel.append(filesLineEl(f.files, keys));
  // A local class's failure plate takes the detail's place (the line drops it): no empty line.
  if (f.detail !== "" || f.files === null) {
    const detail = h("div", "dt", f.detail);
    if (f.describedBy !== null) detail.id = f.describedBy;
    sel.append(detail);
  }
  const b = h("button", "primary") as HTMLButtonElement;
  b.type = "button";
  b.dataset.action = f.action;
  b.disabled = f.disabled;
  if (f.describedBy !== null) b.setAttribute("aria-describedby", f.describedBy);
  b.append(h("span", null, f.button.label), " ", h("span", "kbd", shortcut(f.button.key ?? "Enter")));
  b.addEventListener("click", act);
  if (f.files === null) {
    foot.append(sel, b);
    return foot;
  }
  // The keys of a local class: "Find music files" beside Start, both on the right.
  const acts = h("div", "acts");
  if (f.files.find !== null) acts.append(buttonEl(f.files.find, keys));
  acts.append(b);
  foot.append(sel, acts);
  return foot;
}
