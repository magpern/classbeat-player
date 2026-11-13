// The score: intervals above, songs below, a fixed "now" line. DOM at the edge; positions come
// from score.ts. The strip is one element (`scroll`) that moves sideways as a unit, so the motion
// loop only ever sets one transform.
import { zoneClass } from "../design/zones.ts";
import { el, vw } from "./dom.ts";
import type { ScoreBlock, ScoreClip, ScoreModel } from "./score.ts";

export interface ScoreView {
  readonly element: HTMLElement;
  /** Moves the strip left by this many vw (the clock has run on since the model was drawn). */
  shift(vwLeft: number): void;
}

function pads(pl: number | null, pr: number | null): Record<string, string> {
  const s: Record<string, string> = {};
  if (pl !== null) s["padding-left"] = vw(pl);
  if (pr !== null) s["padding-right"] = vw(pr);
  return s;
}

function renderBlock(b: ScoreBlock): HTMLElement {
  return el("div", { class: `block ${zoneClass(b.zone)}`, style: { left: vw(b.left), width: vw(b.width), ...pads(b.padLeft, b.padRight) } }, [
    el("span", { class: "n", tier: "minor", text: String(b.zone) }),
    el("span", { class: "t", tier: "label", fit: "hide", text: b.name }),
  ]);
}

function renderClip(c: ScoreClip): HTMLElement {
  const style: Record<string, string> = { left: vw(c.left), width: vw(c.width), ...pads(c.padLeft, c.padRight) };
  if (c.phrase !== null) style["--phrase"] = vw(c.phrase);
  const kids: Node[] = [];
  if (c.title !== null) {
    const head: Node[] = [el("b", { tier: "label", clamp: 1, text: c.title })];
    if (c.occurrence !== null) head.push(el("span", { class: "occ", tier: "label", text: c.occurrence }));
    kids.push(el("span", { class: "head" }, head));
  }
  if (c.artist !== null) kids.push(el("span", { class: "a", tier: "label", fit: "hide", text: c.artist }));
  if (c.bpm !== null) kids.push(el("span", { class: "bpm", tier: "label", fit: "hide", text: `${Math.round(c.bpm)} bpm` }));
  return el("div", { class: "clip", style }, kids);
}

export function renderScore(score: ScoreModel): ScoreView {
  const history = [...(score.gone ? [score.gone] : []), ...score.slivers.map((g) => ({ ...g, sliver: true }))].map((g) => el("div", { class: `block gone${"sliver" in g ? " sliver" : ""}`, style: { left: vw(g.left), width: vw(g.width) } }));
  const intervals = el("div", { class: "track iv" }, [...history, ...score.blocks.map(renderBlock)]);
  const songs = el("div", { class: "track songs" }, [
    ...score.clips.map(renderClip),
    ...score.moments.map((m) => el("div", { class: "moment", style: { left: vw(m.left) } }, [el("span", { tier: "label", text: m.label })])),
  ]);
  const scroll = el("div", { class: "scroll" }, [intervals, songs]);
  if (score.endLeft !== null) scroll.append(el("div", { class: "end", style: { left: vw(score.endLeft) } }, [el("span", { tier: "label", text: "End" })]));
  const element = el("section", { class: `score${score.unsure ? " unsure" : ""}` }, [scroll, el("div", { class: "past" }), el("div", { class: "now" })]);
  return {
    element,
    shift: (vwLeft) => {
      scroll.style.transform = vwLeft === 0 ? "" : `translateX(${-vwLeft}vw)`;
    },
  };
}
