// The running screen's text parts: the rail, the clock, the metrics, the cue and the next row.
// DOM at the edge: each function only places what the model decided.
import { zoneClass } from "../design/zones.ts";
import { digits, el } from "./dom.ts";
import type { Child } from "./dom.ts";
import type { ClockModel, MetricModel, NextModel, RailModel } from "./model.ts";

export function renderRail(rail: RailModel): HTMLElement {
  const parts: Node[] = [];
  if (rail.left !== null) parts.push(el("span", { class: "val", tier: "minor" }, digits(rail.left)), el("span", { class: "lbl", tier: "label", text: "left" }));
  if (rail.done !== null) parts.push(el("span", { class: "val done", tier: "minor" }, digits(rail.done)), el("span", { class: "lbl done", tier: "label", text: "done" }));
  // The segment name takes the space that is left and ends in an ellipsis.
  parts.push(rail.segment ? el("span", { class: "lbl seg", tier: "label", clamp: 1, text: rail.segment }) : el("span", { class: "lbl seg" }));
  if (rail.link) parts.push(el("span", { class: `link${rail.link.look === "quiet" ? "" : ` ${rail.link.look}`}${rail.link.news ? " handover" : ""}`, tier: "label", text: rail.link.text }));
  return el("header", { class: "rail" }, parts);
}

export function renderClock(c: ClockModel): HTMLElement {
  const label: Node[] = [];
  if (c.ftpTag) label.push(el("span", { class: "tag", tier: "label", text: "FTP test" }));
  label.push(c.pill ? el("span", { class: "pill", tier: "label", text: "Paused" }) : el("span", { tier: "label", text: c.label }));
  const count = el("div", { class: `count n${c.wide ? " mmss" : ""}${c.estimated ? " est" : ""}`, tier: "hero" }, digits(c.count));
  const kids: Node[] = [el("span", { class: "lbl" }, label), count];
  if (c.line) kids.push(renderLine(c.line));
  return el("section", { class: "clock" }, kids);
}

function renderLine(line: NonNullable<ClockModel["line"]>): HTMLElement {
  if (line.kind === "bars") return el("div", { class: "bars", tier: "minor" }, [el("span", { class: "n", text: String(line.count) }), ` ${line.tail}`]);
  if (line.kind === "song") return el("div", { class: "bars", tier: "minor" }, ["Next song in ", el("span", { class: "n", text: line.time })]);
  return el("div", { class: "bars", tier: "minor", text: line.text });
}

export function renderMetrics(metrics: readonly MetricModel[], beat: HTMLElement | null): HTMLElement {
  const items = metrics.map((m, i) => {
    const value: Child[] = [m.value];
    if (m.unit) value.push(el("small", { tier: "minor", text: m.unit }));
    // The beat dot follows the BPM, the last metric, inside its value.
    if (beat && i === metrics.length - 1) value.push(beat);
    return el("div", { class: "metric" }, [el("span", { class: "lbl", tier: "label", text: m.label }), el("span", { class: "v n", tier: "value" }, value)]);
  });
  return el("section", { class: "metrics" }, items);
}

export function renderCue(cue: { text: string; long: boolean }): HTMLElement {
  return el("p", { class: `cue${cue.long ? " long" : ""}`, tier: "text", lines: 4, text: cue.text });
}

export function renderNext(next: NextModel): HTMLElement {
  const kids: Node[] = [el("span", { class: "lbl", tier: "label", text: "Next" })];
  if (next.end) kids.push(el("span", { class: "v", tier: "minor", text: "End of class" }));
  else {
    kids.push(
      el("span", { class: `chip ${zoneClass(next.zone)}`, tier: "minor", text: String(next.zone) }),
      el("span", { class: "v nm", tier: "minor", clamp: 1, text: next.name }),
      el("span", { class: "v", tier: "minor", text: next.length }),
    );
    // Cadence and position share a wrapper that takes no part in the room's layout (display: contents); the phone layouts move it to a second line.
    const more: Node[] = [];
    if (next.cadence) more.push(el("span", { class: "v dim", tier: "minor", text: next.cadence }));
    if (next.position) more.push(el("span", { class: "v dim", tier: "minor", text: next.position }));
    if (more.length) kids.push(el("span", { class: "more" }, more));
  }
  return el("div", { class: "next" }, kids);
}
