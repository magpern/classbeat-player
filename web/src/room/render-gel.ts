// The gel: the one lit thing on the stage. The element persists between updates so its colour can
// cross over 700 ms at an interval change (and instantly with reduced motion), with a white line
// down its right edge for 160 ms. DOM at the edge; every decision is in the model, except the zone
// name's size, which only a measurement can decide.
import { zoneClass } from "../design/zones.ts";
import { hasThreeTargets } from "./fit.ts";
import { el } from "./dom.ts";
import type { GelModel } from "./model.ts";

export interface GelView {
  readonly element: HTMLElement;
  /** Draws the gel; `changed` is true when the interval (or state) differs from the last draw. */
  update(gel: GelModel, changed: boolean): void;
  /** Measures the zone name again: call when the screen's size or the fonts change. */
  fit(): void;
}

export function createGel(): GelView {
  const element = el("aside", { class: "gel" });
  const edge = el("div", { class: "edge" });

  /**
   * The zone name's size is measured, never counted in characters (room-2d.md, "Zone name on the
   * gel"): one line at --t-value; else at most two lines at --t-value (or its 3:2 step) with no
   * word too wide for the gel and the targets still inside the gel; else --t-minor on at most
   * three lines (two at 3:2 and narrower), ending in an ellipsis.
   */
  function fit(): void {
    const name = element.querySelector<HTMLElement>(".gel-name");
    if (!name || element.hidden) return;
    const set = (tier: "one" | "two" | "long"): void => {
      name.classList.toggle("two", tier === "two");
      name.classList.toggle("long", tier === "long");
      name.dataset.tier = tier === "long" ? "minor" : "value";
      name.dataset.lines = tier === "long" ? "3" : "2";
      if (tier === "long") name.dataset.clamp = "3";
      else delete name.dataset.clamp;
    };
    const lines = (): number => Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight));
    // A word wider than the gel overflows when it may not break; with breaking allowed it would be cut into lines.
    const fits = (maxLines: number): boolean => {
      name.style.overflowWrap = "normal";
      const ok = name.scrollWidth <= name.clientWidth + 1 && lines() <= maxLines && element.scrollHeight <= element.clientHeight + 1;
      name.style.overflowWrap = "";
      return ok;
    };
    set("one");
    if (fits(1)) return;
    set("two");
    if (fits(2)) return;
    set("long");
  }

  function update(gel: GelModel, changed: boolean): void {
    element.className = ["gel", gel.zone === null ? "blank" : zoneClass(gel.zone), gel.look === "down" ? "down" : "", hasThreeTargets(gel.targets) ? "t3" : ""].filter(Boolean).join(" ");
    const head = el("div", { class: "gel-head" });
    if (gel.numeral !== null) head.append(el("span", { class: "gel-num n", tier: "gel", text: gel.numeral }));
    head.append(el("span", { class: "lbl", tier: "label", lines: 2, text: gel.label }));
    const name = el("span", { class: "gel-name n", tier: "value", lines: 2, text: gel.name });
    const targets = el("div", { class: "gel-targets", tier: "minor", lines: 3 }, gel.targets.map((t) => el("span", { text: t })));
    element.replaceChildren(head, name, targets, edge);
    fit();
    if (changed) flash();
  }

  // Restart the edge's animation: remove the class, force a reflow, add it again.
  function flash(): void {
    edge.classList.remove("go");
    void edge.offsetWidth;
    edge.classList.add("go");
  }

  return { element, update, fit };
}
