// The rider's class view (docs/design/rider.md, "Layout"): top line, gel, clock with the position,
// the effort, the next rows and the one key, in one grid that never scrolls. Each part is drawn
// again only when what it shows has changed, so the key under the thumb survives the state
// messages. Text is only ever set with textContent. The effort values are white text, never a
// zone colour (rule 7); hue sits only on the gel and the next chips.
import { zoneClass } from "../../design/zones.ts";
import { digits, el } from "../../room/dom.ts";
import { HINT } from "../core/effort-calc.ts";
import type { Effort } from "../core/effort-calc.ts";
import type { SensorView } from "../core/sensor-view.ts";
import type { ClockView, GelView, NextRow, RunView, TopView } from "../core/view.ts";
import { pageKey } from "./parts.ts";
import { renderSensorBlock } from "./sensors.ts";

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
  const n = el("nav", keys.length > 1 ? { class: "two" } : {}, keys);
  n.setAttribute("aria-label", keys.length > 1 ? "Your numbers and sensors" : "Your numbers");
  return n;
}

const FITS = [["fit-L2", "fit-P2"], ["fit-L1", "fit-P1"]] as const;

type Part = "top" | "gel" | "clock" | "effort" | "done" | "coming" | "keys";
const ORDER: readonly Part[] = ["top", "gel", "clock", "effort", "done", "coming", "keys"];

/** The class view, kept on screen between updates. */
export class RiderRun {
  readonly root = el("main", { class: "run rider" });
  private readonly shown = new Map<Part, { key: string; node: HTMLElement }>();
  private readonly myNumbers: () => void;
  private readonly sensors: (() => void) | null;

  /** `sensors`: the second key's press; null where the page has no sensors key. */
  constructor(myNumbers: () => void, sensors: (() => void) | null = null) {
    this.myNumbers = myNumbers;
    this.sensors = sensors;
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

  /**
   * The next rows give way when the readings need the height (docs/design/sensors.md, "Fitting"):
   * three rows, then two, then one; the effort and the readings never do. The page calls it again when
   * the screen is resized or turned, since the room the readings have changes with it.
   */
  fit(): void {
    const coming = this.shown.get("coming")?.node;
    if (!coming) return;
    coming.classList.remove(...FITS.flat());
    const effort = this.shown.get("effort")?.node;
    if (!effort?.classList.contains("sens")) return;
    // The effort sits in a track that may shrink to nothing, so its readings can spill over the next
    // rows without the page growing: either overflow makes the next rows give way.
    const over = (): boolean => this.root.scrollHeight > this.root.clientHeight || effort.scrollHeight > effort.clientHeight;
    for (const step of FITS) {
      if (!over()) return;
      coming.classList.add(...step);
    }
  }

  update(v: RunView, wakeWorks: boolean, sv: SensorView | null = null): void {
    const wake = wakeWorks || v.done;
    const before = [this.shown.get("effort")?.key, this.shown.get("coming")?.key];
    this.put("top", [v.top, wake], () => renderTop(v.top, wake));
    this.put("gel", v.gel, () => renderGel(v.gel));
    this.put("clock", v.clock, () => (v.clock ? renderClock(v.clock) : null));
    const block = v.effort ? (sv?.block ?? null) : null;
    const zone = v.gel.blank ? null : v.gel.zone;
    this.put("effort", [v.effort, block, block && zone], () => (block ? renderSensorBlock(block, zone) : v.effort ? renderEffort(v.effort) : null));
    this.put("done", v.done, () => (v.done ? el("p", {}, [el("span", { tier: "minor", lines: 2, text: "Thank you for riding." })]) : null));
    this.put("coming", v.coming, () => (v.coming ? renderComing(v.coming) : null));
    const k = this.sensors && sv ? sv.key : null;
    this.put("keys", [v.done, k], () => {
      if (v.done) return null;
      const mine = pageKey("my_numbers", "My numbers", { full: !k }, () => this.myNumbers());
      return nav(k ? [mine, pageKey(k.action, k.label, { full: false, dis: k.dis }, () => (k.dis ? undefined : this.sensors?.()))] : [mine]);
    });
    if (before[0] !== this.shown.get("effort")?.key || before[1] !== this.shown.get("coming")?.key) this.fit();
  }
}
