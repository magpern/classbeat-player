// The only file in layer/ that touches a node's `.style`, and it takes numbers only. Each function is
// `(el, ...numbers)`, checks every number is finite and throws otherwise, and builds its CSS value here
// from a short list of fixed words and `toFixed` output. No function takes or returns a string, so
// nothing the layer is handed can become a style value (a link included). eslint.config.js holds this
// file to that: no link text anywhere, comments too, no `+`, no template with an expression, no `.join`,
// no `String.raw`, no string-typed anything, and no string literal outside the list of words below.
// test/layer-fences.test.ts and test/dom-kit.test.ts show each fence and each throw.

import type { StripPart } from "../src/text-view.ts";

const MAX_DIGITS = 6;

function check(...numbers: number[]): void {
  for (const n of numbers) if (!Number.isFinite(n)) throw new RangeError("not a finite number");
}

function digitsOk(digits: number): void {
  check(digits);
  if (!Number.isInteger(digits) || digits < 0 || digits > MAX_DIGITS) throw new RangeError("digits out of range");
}

/** `left`, in shares of the window width. */
export function setLeft(el: HTMLElement, vw: number, digits: number): void {
  check(vw);
  digitsOk(digits);
  el.style.left = vw.toFixed(digits).concat("vw");
}

export function setWidth(el: HTMLElement, vw: number, digits: number): void {
  check(vw);
  digitsOk(digits);
  el.style.width = vw.toFixed(digits).concat("vw");
}

/** `font-size`, in shares of the window height. */
export function setFontSize(el: HTMLElement, vh: number, digits: number): void {
  check(vh);
  digitsOk(digits);
  el.style.fontSize = vh.toFixed(digits).concat("vh");
}

/**
 * The pattern's beat strip: dark on the "up" beats, clear on the "down" beats, one cycle `cycleVw`
 * wide and starting `offsetVw` from the block's left edge. The parts are fractions of one cycle.
 */
export function setStrip(el: HTMLElement, cycleVw: number, offsetVw: number, parts: readonly StripPart[]): void {
  check(cycleVw, offsetVw);
  let stops = "";
  parts.forEach((p, i) => {
    check(p.from, p.to);
    stops = stops.concat(i === 0 ? "" : ", ", p.up ? "var(--ink) " : "transparent ", (p.from * 100).toFixed(2), "% ", (p.to * 100).toFixed(2), "%");
  });
  el.style.backgroundImage = "linear-gradient(90deg, ".concat(stops, ")");
  el.style.backgroundSize = cycleVw.toFixed(3).concat("vw", " 100%");
  el.style.backgroundPosition = offsetVw.toFixed(3).concat("vw", " 0");
}
