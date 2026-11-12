// The gel: the one lit thing on the stage. The element persists between updates so its colour can
// cross over 700 ms at an interval change (and instantly with reduced motion), with a white line
// down its right edge for 160 ms. DOM at the edge; every decision is in the model.
import { zoneClass } from "../design/zones.ts";
import { hasThreeTargets } from "./fit.ts";
import { el } from "./dom.ts";
import type { GelModel } from "./model.ts";

export interface GelView {
  readonly element: HTMLElement;
  /** Draws the gel; `changed` is true when the interval (or state) differs from the last draw. */
  update(gel: GelModel, changed: boolean): void;
}

export function createGel(): GelView {
  const element = el("aside", { class: "gel" });
  const edge = el("div", { class: "edge" });

  function update(gel: GelModel, changed: boolean): void {
    element.className = ["gel", gel.zone === null ? "blank" : zoneClass(gel.zone), gel.look === "down" ? "down" : "", hasThreeTargets(gel.targets) ? "t3" : ""].filter(Boolean).join(" ");
    const head = el("div", { class: "gel-head" });
    if (gel.numeral !== null) head.append(el("span", { class: "gel-num n", tier: "gel", text: gel.numeral }));
    head.append(el("span", { class: "lbl", tier: "label", lines: 2, text: gel.label }));
    const name =
      gel.nameTier === "long"
        ? el("span", { class: "gel-name n long", tier: "minor", lines: 3, clamp: 3, text: gel.name })
        : el("span", { class: `gel-name n${gel.nameTier === "two" ? " two" : ""}`, tier: "value", lines: 2, text: gel.name });
    const targets = el("div", { class: "gel-targets", tier: "minor", lines: 3 }, gel.targets.map((t) => el("span", { text: t })));
    element.replaceChildren(head, name, targets, edge);
    if (changed) flash();
  }

  // Restart the edge's animation: remove the class, force a reflow, add it again.
  function flash(): void {
    edge.classList.remove("go");
    void edge.offsetWidth;
    edge.classList.add("go");
  }

  return { element, update };
}
