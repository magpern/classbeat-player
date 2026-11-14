// The rider's class view (docs/design/rider.md, "Layout"): top line, gel, clock with the position,
// the effort, the next rows and the one key, in one grid that never scrolls. Each part is drawn
// again only when what it shows has changed, so the key under the thumb survives the state
// messages. Text is only ever set with textContent. The effort values are white text, never a
// zone colour (rule 7); hue sits only on the gel and the next chips.
import { zoneClass } from "../../design/zones.ts";
import { digits, el } from "../../room/dom.ts";
import { HINT } from "../core/effort-calc.ts";
import type { Effort } from "../core/effort-calc.ts";
import type { ClockView, GelView, NextRow, RunView, TopView } from "../core/view.ts";
import { pageKey } from "./parts.ts";

export const WAKE_WORDS = "Set your screen to stay on";

const label = (text: string, cls = "lbl", lines = 1): HTMLElement => el("span", { class: cls, tier: "label", lines, text });

function renderTop(t: TopView, wake: boolean): HTMLElement {
  const first = t.alert
    ? el("span", { class: "link alert", tier: "label", lines: 2, text: t.alert })
    : el("span", { class: "link" }, [el("span", { class: "who-t", tier: "label", clamp: 1, text: t.who })]);
  if (t.alert) first.setAttribute("role", "status");
  const time = el("span", { class: "ct" }, [el("span", { class: "val", tier: "minor" }, digits(t.time)), label(t.timeLabel, "")]);
  // Where the browser cannot keep the screen on, one line under the top line says so.
  return el("header", { class: "top" }, wake ? [first, time] : [first, time, label(WAKE_WORDS, "wake-l", 2)]);
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
  const parts: Node[] = [cl];
  if (c.position) parts.push(el("div", { class: "song" }, [label("Position"), el("span", { class: "when n", tier: "value", text: c.position })]));
  return el("section", { class: "clock" }, parts);
}

function renderEffort(e: Effort): HTMLElement {
  const rows = e.rows.flatMap((r) => [
    label(r.label),
    el("div", { class: "ev" }, [el("span", { class: "n", tier: "value", text: r.value }), ...(r.unit ? [el("span", { class: "u", tier: "minor", text: r.unit })] : [])]),
  ]);
  return el("section", { class: "effort" }, e.hint ? [...rows, label(HINT, "hint", 3)] : rows);
}

function renderComing(rows: readonly NextRow[]): HTMLElement {
  if (rows.length === 0) return el("section", { class: "coming" }, [label("Next"), el("div", { class: "next" }, [el("span", { class: "v", tier: "minor", text: "End of class" })])]);
  return el(
    "section",
    { class: "coming" },
    rows.flatMap(([zone, name, len], k) => [
      k ? el("span", { class: "gap" }) : label("Next"),
      el("div", { class: "next" }, [el("span", { class: `chip ${zoneClass(zone)}`, tier: "minor", text: String(zone) }), el("span", { class: "v nm", tier: "minor", clamp: 1, text: name }), el("span", { class: "v dim", tier: "minor", text: len })]),
    ]),
  );
}

function nav(keys: Node[]): HTMLElement {
  const n = el("nav", {}, keys);
  n.setAttribute("aria-label", "Your numbers");
  return n;
}

type Part = "top" | "gel" | "clock" | "effort" | "done" | "coming" | "keys";
const ORDER: readonly Part[] = ["top", "gel", "clock", "effort", "done", "coming", "keys"];

/** The class view, kept on screen between updates. */
export class RiderRun {
  readonly root = el("main", { class: "run rider" });
  private readonly shown = new Map<Part, { key: string; node: HTMLElement }>();
  private readonly myNumbers: () => void;

  constructor(myNumbers: () => void) {
    this.myNumbers = myNumbers;
  }

  private put(part: Part, value: unknown, draw: () => HTMLElement | null): void {
    const key = JSON.stringify(value ?? null);
    const old = this.shown.get(part);
    if (old?.key === key) return;
    const node = draw();
    const after = old ? old.node.nextSibling : this.place(part);
    old?.node.remove();
    if (!node) {
      this.shown.delete(part);
      return;
    }
    node.classList.add(part);
    this.root.insertBefore(node, after);
    this.shown.set(part, { key, node });
  }

  /** Where a new part goes: before the first part that comes after it. */
  private place(part: Part): Node | null {
    for (const p of ORDER.slice(ORDER.indexOf(part) + 1)) {
      const n = this.shown.get(p)?.node;
      if (n) return n;
    }
    return null;
  }

  update(v: RunView, wakeWorks: boolean): void {
    const wake = wakeWorks || v.done;
    this.put("top", [v.top, wake], () => renderTop(v.top, wake));
    this.put("gel", v.gel, () => renderGel(v.gel));
    this.put("clock", v.clock, () => (v.clock ? renderClock(v.clock) : null));
    this.put("effort", v.effort, () => (v.effort ? renderEffort(v.effort) : null));
    this.put("done", v.done, () => (v.done ? el("p", {}, [el("span", { tier: "minor", lines: 2, text: "Thank you for riding." })]) : null));
    this.put("coming", v.coming, () => (v.coming ? renderComing(v.coming) : null));
    this.put("keys", v.done, () => (v.done ? null : nav([pageKey("my_numbers", "My numbers", {}, () => this.myNumbers())])));
  }
}
