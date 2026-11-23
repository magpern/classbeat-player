// The relative luminance (linear light, 0 to 1) of a screenshot, per region, for the S6 count (scene.md,
// "The flash budget"). A screenshot of the page is a PNG; this decodes it (8-bit, not interlaced, as the
// browser writes it), averages it in linear light over a grid, and sums the grid over the regions the
// measure looks at: the whole screen, the four quadrants, every 1/3 x 1/3 window at a stride of 1/6, and the
// 1/3 rows and columns: 40 in all, as the scene's own gate reads them (player/scene/render/tools/flash-shots.ts).
import { inflateSync } from "node:zlib";

type Rect = readonly [name: string, x0: number, y0: number, x1: number, y1: number];

export const REGIONS: readonly Rect[] = (() => {
  const r: Rect[] = [["whole", 0, 0, 1, 1]];
  for (const [i, [x, y]] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]].entries()) r.push([`quadrant ${i}`, x, y, x + 0.5, y + 0.5]);
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) r.push([`window ${i}${j}`, i / 6, j / 6, i / 6 + 1 / 3, j / 6 + 1 / 3]);
  for (let i = 0; i <= 4; i++) {
    r.push([`row ${i}`, 0, i / 6, 1, i / 6 + 1 / 3]);
    r.push([`column ${i}`, i / 6, 0, i / 6 + 1 / 3, 1]);
  }
  return r;
})();

const LINEAR = Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

interface Pixels {
  readonly width: number;
  readonly height: number;
  /** Bytes per pixel: 3 (RGB) or 4 (RGBA). */
  readonly bpp: number;
  readonly data: Buffer;
}

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG. */
export function decodePng(png: Buffer): Pixels {
  let [pos, width, height, bpp] = [8, 0, 0, 0];
  const parts: Buffer[] = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("latin1", pos + 4, pos + 8);
    const body = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      [width, height] = [body.readUInt32BE(0), body.readUInt32BE(4)];
      if (body[8] !== 8 || body[12] !== 0 || (body[9] !== 2 && body[9] !== 6)) throw new Error("unsupported PNG");
      bpp = body[9] === 2 ? 3 : 4;
    } else if (type === "IDAT") parts.push(body);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * bpp;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? data[y * stride + x - bpp] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? data[(y - 1) * stride + x - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      data[y * stride + x] = (v + add) & 255;
    }
  }
  return { width, height, bpp, data };
}

/** The mean relative luminance of every region of the screenshot, in the order of `REGIONS`. */
export function regionLuminance(png: Buffer, gridW = 96): number[] {
  const { width, height, bpp, data } = decodePng(png);
  const gridH = Math.round((gridW * height) / width);
  const cell = new Float64Array(gridW * gridH);
  for (let gy = 0; gy < gridH; gy++) {
    const [y0, y1] = [Math.floor((gy * height) / gridH), Math.floor(((gy + 1) * height) / gridH)];
    for (let gx = 0; gx < gridW; gx++) {
      const [x0, x1] = [Math.floor((gx * width) / gridW), Math.floor(((gx + 1) * width) / gridW)];
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * bpp;
          sum += 0.2126 * LINEAR[data[i]] + 0.7152 * LINEAR[data[i + 1]] + 0.0722 * LINEAR[data[i + 2]];
        }
      }
      cell[gy * gridW + gx] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return REGIONS.map(([, x0, y0, x1, y1]) => {
    const [a, b, c, d] = [Math.round(x0 * gridW), Math.round(y0 * gridH), Math.round(x1 * gridW), Math.round(y1 * gridH)];
    let sum = 0;
    for (let y = b; y < d; y++) for (let x = a; x < c; x++) sum += cell[y * gridW + x];
    return sum / ((c - a) * (d - b));
  });
}
