// The dark-under-text rule (scene.md S2, "Text over light"): inside every text line's box, grown by
// 1.2 vh and faded out over a further 3 vh, the scene's relative luminance is at most the cap
// (`--scene-text-cap`, 0.08; the mock-up keeps 0.075 as a margin). The mask clamps what is drawn,
// so it darkens real light whatever the rig does, a burst included. These are its numbers and the
// geometry the shader repeats; the shader is src/text-mask.ts. Pure.

import type { TextBox } from "./text-box.ts";

/** The spec's growth (1.2 vh) and fade (3 vh), as shares of the window height. */
export const SPEC_GROW = 0.012;
export const FADE = 0.03;
/** What the mask grows a box by: the spec's 1.2 vh and 0.3 vh over, for the scene's render scale (it is drawn at 0.75 and less, so an edge pixel is blended). */
export const GROW = SPEC_GROW + 0.003;
/** The share of the cap the mask holds the light to (0.075 of 0.08). */
export const CAP_MARGIN = 0.075 / 0.08;
export const MAX_BOXES = 48;

/** A box in window-height units with y up (x runs 0 to the aspect ratio, y 0 to 1). */
export interface MaskBox {
  readonly l: number;
  readonly b: number;
  readonly r: number;
  readonly t: number;
}

/** The sRGB encoding of a linear level: the canvas holds encoded values, and the clamp is applied to them. */
export function encodeSrgb(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function decodeSrgb(encoded: number): number {
  return encoded <= 0.04045 ? encoded / 12.92 : Math.pow((encoded + 0.055) / 1.055, 2.4);
}

/** A text box (CSS pixels, y down) in the mask's units. At most `MAX_BOXES` are kept; the layer keeps under it by measuring one box per text line. */
export function maskBoxes(boxes: readonly TextBox[], height: number): MaskBox[] {
  const h = Math.max(1, height);
  return boxes.slice(0, MAX_BOXES).map((b) => ({ l: b.left / h, b: 1 - b.bottom / h, r: b.right / h, t: 1 - b.top / h }));
}

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The weight of one box's mask at a point (x, y in window-height units, y up): 1 inside the grown box, 0 past the fade. */
export function boxWeight(x: number, y: number, m: MaskBox): number {
  // The distance outside the box along the larger axis, so the grown box has square corners (Chebyshev, not round).
  const dist = Math.max(Math.max(m.l - x, x - m.r), Math.max(m.b - y, y - m.t));
  return 1 - smooth(GROW, GROW + FADE, dist);
}

/** The mask's weight at a point from all boxes: the largest, which is what drawing them with `min` gives. */
export const maskWeight = (x: number, y: number, boxes: readonly MaskBox[]): number => boxes.reduce((w, m) => Math.max(w, boxWeight(x, y, m)), 0);

/** The area to measure under a box: grown by the spec's 1.2 vh, where the cap must hold. */
export function grownBox(b: TextBox, height: number): TextBox {
  const g = SPEC_GROW * height;
  return { left: b.left - g, top: b.top - g, right: b.right + g, bottom: b.bottom + g };
}
