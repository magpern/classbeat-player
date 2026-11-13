// The class code's QR code drawn as an inline SVG (the room page allows no images): black modules
// on white, with the 4-module quiet zone inside the box. The modules come from core/room/qr.ts.
import { QR_QUIET, QR_SIZE, qrCode } from "../core/room/qr.ts";

const SVG = "http://www.w3.org/2000/svg";

export function qrSvg(address: string): SVGSVGElement | null {
  const q = qrCode(address);
  if (!q) return null;
  const n = QR_SIZE + 2 * QR_QUIET;
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
  q.modules.forEach((row, y) => row.forEach((on, x) => (d += on ? `M${x + QR_QUIET} ${y + QR_QUIET}h1v1h-1z` : "")));
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000000");
  svg.append(bg, path);
  return svg;
}
