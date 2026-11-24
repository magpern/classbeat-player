// The sensor panel's pieces, drawn from a SensorsView with textContent and attributes only (no
// markup from a device name, no style). The gauge is one straight line with a band and a tick, never
// a ring (rule 6); its tick is white wherever it stands and the only hue is the band, the planned
// zone (rule 7).
import { ZONE_HUES } from "../core/sensors/zone-hue.ts";
import type { DeviceView, MeasureView, SensorsView } from "../core/sensors/view.ts";
import { TEXT } from "../core/sensors/strings.ts";

export const GAUGE_W = 240;
export const GAUGE_H = 12;
export const TRACK_FILL = "#2b2b2b";
export const TRACK_EDGE = "#777777";
export const BAND_FALLBACK = "#9a9a9a";
export const TICK_FILL = "#ffffff";
export const TICK_EDGE = "#000000";

const SVG = "http://www.w3.org/2000/svg";
function rect(attrs: Record<string, string | number>): SVGRectElement {
  const r = document.createElementNS(SVG, "rect");
  for (const [k, v] of Object.entries(attrs)) r.setAttribute(k, String(v));
  return r;
}

export function drawGauge(m: MeasureView): SVGSVGElement | null {
  const g = m.gauge;
  if (!g) return null;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", String(GAUGE_W));
  svg.setAttribute("height", String(GAUGE_H));
  svg.setAttribute("role", "meter");
  svg.setAttribute("aria-label", m.alt);
  svg.setAttribute("aria-valuemin", String(Math.round(g.track[0])));
  svg.setAttribute("aria-valuemax", String(Math.round(g.track[1])));
  if (m.value !== null) svg.setAttribute("aria-valuenow", String(m.value));
  svg.append(rect({ x: 0.5, y: 0.5, width: GAUGE_W - 1, height: GAUGE_H - 1, fill: TRACK_FILL, stroke: TRACK_EDGE, "stroke-width": 1 }));
  const hue = (m.zone !== null ? ZONE_HUES[m.zone] : undefined) ?? BAND_FALLBACK;
  svg.append(rect({ "data-part": "band", x: g.band[0] * GAUGE_W, y: 2, width: Math.max(1, (g.band[1] - g.band[0]) * GAUGE_W), height: GAUGE_H - 4, fill: hue }));
  if (g.tick !== null) svg.append(rect({ "data-part": "tick", x: Math.min(GAUGE_W - 3, Math.max(1, g.tick * GAUGE_W - 1)), y: 1, width: 2, height: GAUGE_H - 2, fill: TICK_FILL, stroke: TICK_EDGE, "stroke-width": 1 }));
  return svg;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  return e;
};

const valueText = (m: MeasureView): string => (m.value === null ? TEXT.missing : String(m.value));

/** The closed row's live numbers: "142 bpm  238 W  92 rpm", a dash for a missing one. */
export function liveText(v: SensorsView): string {
  return v.measures.map((m) => `${valueText(m)} ${m.unit}`).join("   ");
}

export function measureItem(m: MeasureView): HTMLLIElement {
  const li = el("li");
  li.dataset.measure = m.measure;
  const head = el("p");
  head.append(el("strong", m.label), " ", el("span", m.plan));
  const read = el("p");
  const g = drawGauge(m);
  if (g) read.append(g, " ");
  const num = el("output", valueText(m));
  num.dataset.part = "value";
  read.append(num, " ", el("span", m.unit));
  li.append(head, read);
  if (m.lost) li.append(el("p", TEXT.lost));
  return li;
}

export function deviceItem(d: DeviceView, act: (id: string, reconnect: boolean) => void): HTMLLIElement {
  const li = el("li");
  li.dataset.device = d.id;
  const name = el("span", d.name);
  name.dir = "auto";
  const b = el("button", d.action);
  b.type = "button";
  b.setAttribute("aria-label", `${d.action} ${d.name}`);
  b.addEventListener("click", () => act(d.id, d.canReconnect));
  li.append(name, " ", el("span", d.state), " ", b);
  return li;
}

export function nearbyItem(d: SensorsView["nearby"][number], choose: (id: string) => void): HTMLLIElement {
  const li = el("li");
  const name = el("span", d.name);
  name.dir = "auto";
  const b = el("button", TEXT.choose);
  b.type = "button";
  b.setAttribute("aria-label", `${TEXT.choose} ${d.name}`);
  b.addEventListener("click", () => choose(d.id));
  li.append(name, " ", el("span", d.service), " ", b);
  return li;
}
