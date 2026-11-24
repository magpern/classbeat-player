// The rider's sensor readings on screen (docs/design/sensors.md, part 1): the effort block with each
// measure's plan, gauge and reading, the plate, the line, and the two sheets. Text is only ever set
// with textContent, positions only through the style object (no markup, no style strings). A
// reading is white or grey, never a colour; only the planned band takes the zone's hue (rule 7).
import { zoneClass } from "../../design/zones.ts";
import { el } from "../../room/dom.ts";
import type { MeasureRow, Reading, SensorBlock } from "../core/sensor-view.ts";
import { h1, pageKey, para } from "./parts.ts";
import { page } from "./form.ts";

export const SHEET_NOTE = "Readings stay on this phone. Nothing is sent, saved or compared.";
export const UNSUPPORTED = {
  head: "This browser cannot connect to a sensor",
  android: "Open this page in Chrome on an Android phone.",
  iphone: "On an iPhone, this page gives you the targets and the timing. Sensors on an iPhone need the classbeat Player app.",
} as const;

const label = (text: string, cls: string, lines = 1): HTMLElement => el("span", { class: cls, tier: "label", lines, text });

function gaugeOf(r: Reading, zone: number | null): HTMLElement | null {
  if (r.gauge === "solo") return null;
  if (r.gauge === "none") return el("div", { class: "gauge none" });
  const g = r.gauge;
  const band = el("i", { class: "band", style: { left: `${g.bandLeft}%`, width: `${g.bandWidth}%` } });
  const mark = g.tick === null ? [] : [el("i", { class: "mark", style: { left: `${g.tick}%` } })];
  const box = el("div", { class: `gauge ${zoneClass(zone ?? 1)}` }, [band, ...mark]);
  box.setAttribute("role", "meter");
  box.setAttribute("aria-label", r.aria);
  box.setAttribute("aria-valuemin", "0");
  box.setAttribute("aria-valuemax", "100");
  if (g.tick !== null) box.setAttribute("aria-valuenow", String(g.tick));
  return box;
}

function measure(m: MeasureRow, zone: number | null): HTMLElement {
  const plan = m.plan
    ? [el("span", { class: "n", tier: "value", text: m.plan.value }), ...(m.plan.unit ? [el("span", { class: "u", tier: "minor", text: m.plan.unit })] : [])]
    : [];
  const parts: Node[] = [label(m.label, "lbl"), el("div", { class: "ev" }, plan)];
  const r = m.read;
  if (r) {
    const g = gaugeOf(r, zone);
    if (g) parts.push(g);
    const cls = ["rd", r.value === null && "none", r.gauge === "solo" && "solo"].filter(Boolean).join(" ");
    parts.push(el("div", { class: cls }, [el("span", { class: "n", tier: "read", text: r.value === null ? "–" : String(r.value) }), el("span", { class: "u", tier: "minor", text: r.unit })]));
  }
  return el("div", { class: "m" }, parts);
}

/** The effort block with the readings, in the effort's place. */
export function renderSensorBlock(b: SensorBlock, zone: number | null): HTMLElement {
  const parts: Node[] = b.rows.map((m) => measure(m, zone));
  if (b.plate) {
    const p = el("div", { class: "splate" }, [el("span", { class: "h", tier: "minor", lines: 1, text: b.plate.head }), ...(b.plate.detail ? [label(b.plate.detail, "dt", 3)] : [])]);
    p.setAttribute("role", "alert");
    parts.push(p);
  } else if (b.hint) {
    parts.push(label(b.hint, "hint", 3));
  }
  return el("section", { class: "effort sens" }, parts);
}

export interface SheetRow {
  readonly id: string;
  readonly name: string;
  readonly words: string;
  readonly lost: boolean;
}

export interface SheetHandlers {
  disconnect(id: string): void;
  reconnect(id: string): void;
  add(): void;
  done(): void;
}

/** The sensors sheet: each device with its state in words, Connect another sensor, Done. */
export function sensorsSheet(rows: readonly SheetRow[], h: SheetHandlers): HTMLElement {
  const devs = rows.map((d) =>
    el("div", { class: d.lost ? "dev lost" : "dev" }, [
      el("div", { class: "who" }, [el("span", { tier: "minor", lines: 2, clamp: 2, text: d.name }), label(d.words, "st", 3)]),
      d.lost ? pageKey("reconnect_sensor", "Reconnect", { full: false }, () => h.reconnect(d.id)) : pageKey("disconnect_sensor", "Disconnect", { full: false }, () => h.disconnect(d.id)),
    ]),
  );
  return page(
    [h1("Sensors"), para(SHEET_NOTE, true)],
    [el("div", { class: "devs" }, devs), pageKey("sensors_add", "Connect another sensor", {}, () => h.add()), pageKey("done", "Done", { main: true }, () => h.done())],
  );
}

/** The sheet for a browser that cannot connect: it says so and names what works. */
export function unsupportedSheet(iphone: boolean, done: () => void): HTMLElement {
  return page(
    [h1(UNSUPPORTED.head, 3), para(iphone ? UNSUPPORTED.iphone : UNSUPPORTED.android), para(SHEET_NOTE, true)],
    [el("div", { class: "duo solo" }, [pageKey("done", "Done", { main: true }, () => done())])],
  );
}
