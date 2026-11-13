// The class view (docs/design/companion.md, "Layout"): top line, gel, clock, cue, the next rows and
// the keys, in one grid that never scrolls. Each part is drawn again only when what it shows has
// changed, so a key under the thumb survives the state messages that come every second. Text is
// only ever set with textContent.
import { zoneClass } from "../../design/zones.ts";
import { digits, el } from "../../room/dom.ts";
import type { ClockView, GelView, RunView, TopView } from "../core/view.ts";
import { fitCue } from "./fit.ts";
import { renderKeys } from "./keys.ts";
import type { KeyHandlers } from "./keys.ts";

const label = (text: string, cls = "lbl", lines = 1): HTMLElement => el("span", { class: cls, tier: "label", lines, text });

function renderTop(t: TopView): HTMLElement {
  const first = t.note
    ? el("span", { class: "note" }, [el("span", { class: "h", tier: "label", clamp: 1, text: t.note })])
    : el("span", { class: `link ${t.link?.kind ?? ""}`.trim(), tier: "label", lines: 2, text: t.link?.text ?? "" });
  if (t.note) first.setAttribute("role", "status");
  const time = el("span", { class: "ct" }, [el("span", { class: "val", tier: "minor" }, digits(t.time)), label(t.timeLabel, "")]);
  return el("header", { class: "top" }, [first, time]);
}

function renderGel(g: GelView): HTMLElement {
  if (g.blank) {
    return el("section", { class: "gel blank" }, [el("div", { class: "gel-txt" }, [el("span", { class: "gel-name n", tier: "value", text: g.name }), el("span", { class: "gel-tg", tier: "minor", text: g.sub })])]);
  }
  const name = el("span", { class: `gel-name n${g.name.length > 24 ? " long" : ""}`, tier: "value", lines: 2, clamp: 2, text: g.name });
  const txt = el("div", { class: "gel-txt" }, g.label ? [label(g.label), name] : [name]);
  return el("section", { class: `gel ${zoneClass(g.zone)}${g.down ? " down" : ""}` }, [el("span", { class: "gel-num n", tier: "gel", text: String(g.zone) }), txt]);
}

function renderClock(c: ClockView): HTMLElement {
  const lbl = el("span", { class: "lbl" }, [...(c.pill ? [el("span", { class: "pill", tier: "label", text: c.pill })] : []), el("span", { tier: "label", text: c.label })]);
  const cl = el("div", { class: "cl" }, [lbl, el("div", { class: `count n${c.est ? " est" : ""}`, tier: "hero" }, digits(c.time))]);
  const s = c.song;
  const song = s
    ? el("div", { class: "song" }, [label(s.label), el("span", { class: `when n${s.dim ? " dim" : ""}`, tier: "value", lines: 2, text: s.when }), el("span", { class: "st", tier: "minor", clamp: 1, text: s.title }), el("span", { class: "sa", tier: "label", clamp: 1, text: s.artist })])
    : el("div", { class: "song" }, [label("Next song"), el("span", { class: "when n", tier: "value", text: "None left" })]);
  return el("section", { class: "clock" }, [cl, song]);
}

function renderCue(text: string): HTMLElement {
  return el("p", { class: `cue${text.length > 60 ? " long" : ""}`, tier: "text", lines: 8, text });
}

function renderComing(rows: RunView["coming"]): HTMLElement {
  if (!rows || rows.length === 0) return el("section", { class: "coming" }, [label("Next"), el("div", { class: "next" }, [el("span", { class: "v", tier: "minor", text: "End of class" })])]);
  return el(
    "section",
    { class: "coming" },
    rows.flatMap(([zone, name, len], k) => [
      k ? el("span", { class: "gap" }) : label("Next"),
      el("div", { class: "next" }, [el("span", { class: `chip ${zoneClass(zone)}`, tier: "minor", text: String(zone) }), el("span", { class: "v nm", tier: "minor", clamp: 1, text: name }), el("span", { class: "v dim", tier: "minor", text: len })]),
    ]),
  );
}

type Part = "top" | "gel" | "clock" | "cue" | "coming" | "keys";

/** The class view, kept on screen between updates. */
export class RunScreen {
  readonly root = el("main", { class: "run" });
  private readonly shown = new Map<Part, { key: string; node: HTMLElement }>();
  private readonly handlers: KeyHandlers;

  constructor(handlers: KeyHandlers) {
    this.handlers = handlers;
  }

  private put(part: Part, value: unknown, draw: () => HTMLElement | null): boolean {
    const key = JSON.stringify(value ?? null);
    const old = this.shown.get(part);
    if (old?.key === key) return false;
    const node = draw();
    if (old) old.node.remove();
    if (node) {
      node.classList.add(part);
      const after = old?.node.nextSibling ?? null;
      this.root.insertBefore(node, old ? after : this.place(part));
      this.shown.set(part, { key, node });
    } else this.shown.delete(part);
    return true;
  }

  /** Where a new part goes: before the first part that comes after it. */
  private place(part: Part): Node | null {
    const order: Part[] = ["top", "gel", "clock", "cue", "coming", "keys"];
    for (const p of order.slice(order.indexOf(part) + 1)) {
      const n = this.shown.get(p)?.node;
      if (n) return n;
    }
    return null;
  }

  update(v: RunView): void {
    let layout = false;
    layout = this.put("top", v.top, () => renderTop(v.top)) || layout;
    layout = this.put("gel", v.gel, () => renderGel(v.gel)) || layout;
    layout = this.put("clock", v.clock, () => (v.clock ? renderClock(v.clock) : null)) || layout;
    layout = this.put("cue", v.cue, () => (v.cue === null ? null : renderCue(v.cue))) || layout;
    layout = this.put("coming", v.coming, () => (v.coming === null ? null : renderComing(v.coming))) || layout;
    layout = this.put("keys", v.keys, () => renderKeys(v.keys, this.handlers)) || layout;
    if (layout) this.fit();
  }

  /** The fitting steps (companion.md, "Fitting text"), again after a change of size. */
  fit(): void {
    fitCue(this.root);
  }
}
