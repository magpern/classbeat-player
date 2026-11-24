// The strict S6 gate's pixel reader (scene.md, "The flash budget"): the relative luminance, in linear light, of each
// region of a screenshot, by a summed-area table. Decodes the PNG Chrome writes (8-bit, RGB or RGBA, not interlaced).
import { inflateSync } from "node:zlib";

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGBA, row after row. */
  readonly data: Uint8Array;
}

export function decodePng(png: Uint8Array): Pixels {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let [width, height, depth, kind, interlace] = [0, 0, 0, 0, 0];
  const idat: Uint8Array[] = [];
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") [width, height, depth, kind, interlace] = [view.getUint32(at + 8), view.getUint32(at + 12), body[8]!, body[9]!, body[12]!];
    else if (type === "IDAT") idat.push(body);
    at += 12 + len;
  }
  if (depth !== 8 || (kind !== 2 && kind !== 6) || interlace !== 0) throw new Error(`unsupported PNG: depth ${depth}, colour type ${kind}, interlace ${interlace}`);
  const bpp = kind === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    line.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const add = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      line[i] = (line[i]! + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = line[x * bpp]!;
      out[o + 1] = line[x * bpp + 1]!;
      out[o + 2] = line[x * bpp + 2]!;
      out[o + 3] = 255;
    }
    prev = Uint8Array.from(line);
  }
  return { width, height, data: out };
}

const LINEAR = Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
});

export type Rect = readonly [name: string, x0: number, y0: number, x1: number, y1: number];

/** The mean relative luminance (linear light, 0 to 1) of every region, as shares of the width and the height. */
export function regionLuminance(p: Pixels, regions: readonly Rect[]): number[] {
  const { width: w, height: h } = p;
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = 0.2126 * LINEAR[p.data[i]!]! + 0.7152 * LINEAR[p.data[i + 1]!]! + 0.0722 * LINEAR[p.data[i + 2]!]!;
      sat[(y + 1) * (w + 1) + x + 1] = lum + sat[y * (w + 1) + x + 1]! + sat[(y + 1) * (w + 1) + x]! - sat[y * (w + 1) + x]!;
    }
  return regions.map(([, x0, y0, x1, y1]) => {
    const [a, b, c, d] = [Math.round(x0 * w), Math.round(y0 * h), Math.round(x1 * w), Math.round(y1 * h)];
    return (sat[d * (w + 1) + c]! - sat[b * (w + 1) + c]! - sat[d * (w + 1) + a]! + sat[b * (w + 1) + a]!) / ((c - a) * (d - b));
  });
}

/** The 40 regions the scene's gate looks at: the whole screen, the four quadrants, every 1/3 x 1/3 window at a 1/6 stride, the 1/3 strips. */
export const REGIONS: readonly Rect[] = (() => {
  const r: Rect[] = [["whole", 0, 0, 1, 1]];
  for (const [i, [x, y]] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]].entries()) r.push([`quadrant ${i}`, x!, y!, x! + 0.5, y! + 0.5]);
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) r.push([`window ${i}${j}`, i / 6, j / 6, i / 6 + 1 / 3, j / 6 + 1 / 3]);
  for (let i = 0; i <= 4; i++) {
    r.push([`row ${i}`, 0, i / 6, 1, i / 6 + 1 / 3]);
    r.push([`column ${i}`, i / 6, 0, i / 6 + 1 / 3, 1]);
  }
  return r;
})();
