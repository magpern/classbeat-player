// Paints the class list's `Screen` (core/list/screen.ts) into the page. Text only through
// textContent; nothing from a class becomes markup. Each region is rebuilt only when what it shows
// changed, so a poll that finds nothing new touches nothing (and never moves the focus or the
// scroll position).
import type { Footer, RowModel } from "../core/list/screen.ts";
import type { Button, Panel, Plate, StatusLine } from "../core/list/states.ts";

export type Act = (id: Button["id"]) => void;

export function h(tag: string, cls: string | null, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (cls !== null) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** "Ctrl+O" is "Cmd+O" on a Mac. */
export const shortcut = (key: string): string => (navigator.platform.startsWith("Mac") ? key.replace("Ctrl", "Cmd") : key);

export function buttonEl(b: Button, act: Act): HTMLButtonElement {
  const el = h("button", b.primary ? "primary" : null) as HTMLButtonElement;
  el.type = "button";
  el.dataset.action = b.id;
  el.append(h("span", null, b.label));
  if (b.key !== null) el.append(" ", h("span", "kbd", shortcut(b.key)));
  el.addEventListener("click", () => act(b.id));
  return el;
}

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

export function footerEl(f: Footer, act: () => void): HTMLElement {
  const foot = h("footer", "foot");
  const sel = h("div", "sel");
  const t = h("div", "t");
  t.append(h("span", null, f.title));
  sel.append(t, h("div", "dt", f.detail));
  const b = h("button", "primary") as HTMLButtonElement;
  b.type = "button";
  b.dataset.action = f.action;
  b.append(h("span", null, f.button.label), " ", h("span", "kbd", shortcut(f.button.key ?? "Enter")));
  b.addEventListener("click", act);
  foot.append(sel, b);
  return foot;
}
