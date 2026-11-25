// The running screen's text parts: the rail, the clock, the metrics, the cue and the next row.
// DOM at the edge: each function only places what the model decided.
import { zoneClass } from "../design/zones.ts";
import { digits, el } from "./dom.ts";
import type { Child } from "./dom.ts";
import type { ClockModel, MetricModel, NextModel, PatternValue, RailModel } from "./model.ts";

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
  return el("div", { class: "bars text", tier: "minor", text: line.text });
}

/** The Position value of a pattern interval: side and count on one baseline, or a note (room-2d.md, "A position pattern"). */
function patternValueEl(p: PatternValue): HTMLElement {
  if (p.kind === "note") return el("span", { class: "v note", tier: "label", lines: 3, text: p.text });
  const kids: Node[] = [el("b", { class: "side", tier: "value", text: p.side })];
  // Each figure sits in its own cell, so the count never shifts as it steps.
  kids.push(p.kind === "count" ? el("b", { class: "cnt", tier: "count" }, digits(p.count)) : el("span", { class: "soon", tier: "label", lines: 2, text: p.text }));
  return el("span", { class: "v n pv" }, kids);
}

export function renderMetrics(metrics: readonly MetricModel[]): HTMLElement {
  const items = metrics.map((m) => {
    const label = el("span", { class: "lbl", tier: "label", text: m.label });
    if (m.pattern) return el("div", { class: "metric" }, [label, patternValueEl(m.pattern)]);
    const value: Child[] = [m.value];
    if (m.unit) value.push(el("small", { tier: "minor", text: m.unit }));
    return el("div", { class: "metric" }, [label, el("span", { class: m.incline ? "v n inc" : "v n", tier: "value" }, value)]);
  });
  // A pattern's count closes the column's gap so the cue below keeps its place.
  return el("section", { class: `metrics${metrics.some((m) => m.pattern) ? " fold" : ""}` }, items);
}

export function renderCue(cue: { text: string; long: boolean }): HTMLElement {
  // `data-by-length`: the model's choice by character count; fit-cue.ts measures the rest.
  const p = el("p", { class: `cue${cue.long ? " long" : ""}`, tier: "text", lines: 4, text: cue.text });
  if (cue.long) p.dataset.byLength = "1";
  return p;
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
  // Line 1 is `.nline`; line 2 is the next interval's cue, as written, ending in an ellipsis (room-2d.md, "Next row").
  const rows: Node[] = [el("div", { class: "nline" }, kids)];
  if (next.cue) rows.push(el("span", { class: "ncue", tier: "label", clamp: 1, text: next.cue }));
  return el("div", { class: "next" }, rows);
}

/**
 * The phone layouts of the web player page (play.md, "Small landscape") let a fact label, the incline target and the
 * pause line take up to two lines; the room's own layout never does, so its checks keep their one
 * line. Set by the mount from the layout in use, and removed again when it is the room's.
 */
export function allowTwoLines(root: ParentNode, allowed: boolean): void {
  for (const e of root.querySelectorAll<HTMLElement>(".facts .lbl, .bars.text, .metric .v.inc")) {
    if (allowed) e.dataset.lines = "2";
    else delete e.dataset.lines;
  }
}
