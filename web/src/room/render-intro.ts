// Before the start and after the end: the class title, its facts and the time in each zone.
// DOM at the edge. The one thing only a measurement can answer is whether the title fits its line
// at the large size; it is measured here, and a title that does not fit steps down.
import { zoneClass } from "../design/zones.ts";
import { el } from "./dom.ts";
import type { IntroModel } from "./model.ts";

export function renderIntro(intro: IntroModel): HTMLElement {
  const h1 = el("h1", { tier: "value", text: intro.title });
  const facts = el(
    "div",
    { class: "facts" },
    intro.facts.map((f) => el("div", {}, [el("span", { class: "lbl", tier: "label", text: f.label }), el("span", { class: "v n", tier: "value", text: f.value })])),
  );
  const zones = el(
    "div",
    { class: "zones" },
    intro.zones.map((z) =>
      el("div", { class: zoneClass(z.zone) }, [
        el("span", { class: "n", tier: "minor", text: String(z.zone) }),
        el("span", { class: "tm", tier: "minor", text: z.time }),
        // A name wraps to two lines; a longer one ends in an ellipsis (the presenter shows it whole).
        el("span", { class: "t", tier: "label", lines: 2, clamp: 2, text: z.name }),
      ]),
    ),
  );
  // The zones and their title share a wrapper that takes no part in the room's layout (display: contents).
  return el("section", { class: "intro" }, [h1, facts, el("div", { class: "zwrap" }, [el("span", { class: "lbl ztitle", tier: "label", text: intro.zonesTitle }), zones])]);
}

/**
 * The title on one line, then an ellipsis, by design: the phone layouts of the web player page
 * (docs/design/play.md, "Fitting text") set it so whatever its length, and the markup says so for the checks.
 */
export function clampTitle(h1: HTMLElement): void {
  h1.classList.add("long");
  h1.dataset.lines = "1";
  h1.dataset.clamp = "1";
}

/**
 * Steps a title that needs more than one line at the large size down to `--t-value` (room-2d.md,
 * "Class title"). Call it once the element is in the page and the fonts are loaded, and again when
 * the screen's size changes.
 */
export function fitTitle(h1: HTMLElement): void {
  h1.classList.remove("long");
  delete h1.dataset.lines;
  delete h1.dataset.clamp;
  const lineHeight = parseFloat(getComputedStyle(h1).lineHeight);
  if (h1.offsetHeight > lineHeight * 1.5) {
    h1.classList.add("long");
    h1.dataset.lines = "2";
    h1.dataset.clamp = "2";
  }
}
