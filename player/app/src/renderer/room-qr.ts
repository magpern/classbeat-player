// The room screen's QR codes drawn as inline SVG (the room page allows no images): black modules on
// white, with the 4-module quiet zone inside the box. The band's code is version 3 only, the size
// its box and check C10 are drawn for (core/room/qr.ts). The join sheet's codes are sized in vh, not
// in modules, so an address too long for version 3 takes the next version that fits (room-join.md
// J3: the modules get smaller) from the general encoder (core/qr/qr-encode.ts).
import { encodeQr } from "../core/qr/qr-encode.ts";
import { QR_QUIET, qrCode } from "../core/room/qr.ts";

const SVG = "http://www.w3.org/2000/svg";

function draw(modules: readonly (readonly boolean[])[]): SVGSVGElement {
  const n = modules.length + 2 * QR_QUIET;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "qr");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-label", "QR code of the class code");
  const bg = document.createElementNS(SVG, "rect");
  bg.setAttribute("width", String(n));
  bg.setAttribute("height", String(n));
  bg.setAttribute("fill", "#ffffff");
  let d = "";
  modules.forEach((row, y) => row.forEach((on, x) => (d += on ? `M${x + QR_QUIET} ${y + QR_QUIET}h1v1h-1z` : "")));
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000000");
  svg.append(bg, path);
  return svg;
}

/** The band's code: version 3, or null when the address does not fit it. */
export function qrSvg(address: string): SVGSVGElement | null {
  const q = qrCode(address);
  return q ? draw(q.modules) : null;
}

/** The join sheet's code: version 3 where it fits, else the smallest version that does. */
export function sheetQrSvg(address: string): SVGSVGElement | null {
  const q = qrCode(address);
  if (q) return draw(q.modules);
  try {
    return draw(encodeQr(address).rows);
  } catch {
    return null;
  }
}
