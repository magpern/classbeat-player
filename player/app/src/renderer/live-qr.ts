// The QR code of the presenter's control link (ADR 0005 section 3; companion.md, "Getting
// control"): drawn while the control code is shown and removed, not just hidden, as soon as the
// view has no link (one display, the code used, run out, replaced or ended by a Drop). Presenter
// window only: the room window has no part of it. Drawn as one SVG path with presentation
// attributes, so it needs no style and no image source under the presenter's CSP.
import { encodeQr } from "../core/qr/qr-encode.ts";

const SVG = "http://www.w3.org/2000/svg";
/** Light modules around the symbol, as the standard asks. */
export const QUIET = 4;
/** CSS pixels per module. */
export const MODULE_PX = 6;

/** The path of the dark modules, one unit square each, offset by the quiet zone. */
export function qrPath(rows: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  rows.forEach((row, y) => row.forEach((dark, x) => void (dark && parts.push(`M${x + QUIET} ${y + QUIET}h1v1h-1z`))));
  return parts.join("");
}

function svg(link: string): SVGSVGElement {
  const qr = encodeQr(link);
  const side = qr.size + 2 * QUIET;
  const el = document.createElementNS(SVG, "svg");
  const attrs: Record<string, string> = {
    id: "live-qr-code",
    viewBox: `0 0 ${side} ${side}`,
    width: String(side * MODULE_PX),
    height: String(side * MODULE_PX),
    "shape-rendering": "crispEdges",
    role: "img",
    "aria-label": "QR code of the control page with both codes",
  };
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  const back = document.createElementNS(SVG, "rect");
  for (const [k, v] of Object.entries({ id: "live-qr-light", width: String(side), height: String(side), fill: "#ffffff" })) back.setAttribute(k, v);
  const dark = document.createElementNS(SVG, "path");
  for (const [k, v] of Object.entries({ id: "live-qr-dark", d: qrPath(qr.rows), fill: "#000000" })) dark.setAttribute(k, v);
  el.append(back, dark);
  return el;
}

let drawn: string | null = null;

/** Shows the QR code of this link in the box, or empties and hides the box when there is none. */
export function renderQr(box: HTMLElement, holder: HTMLElement, link: string | null): void {
  box.hidden = link === null;
  if (link === drawn) return;
  drawn = link;
  holder.replaceChildren(...(link === null ? [] : [svg(link)]));
}
