// A reader for the PNG a headless Chrome screenshot writes (8-bit, not interlaced, RGB or RGBA), with Node's own zlib: the
// whole-frame S6 gate (tools/flash-shots.ts) needs the text layer's pixels from the page and no image library is a dependency.

import { inflateSync } from "node:zlib";

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGBA, 8 bits each, row by row. */
  readonly data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Uint8Array): Pixels {
  const buf = Buffer.from(file);
  if (!SIGNATURE.every((v, i) => buf[i] === v)) throw new Error("not a PNG");
  let [width, height, depth, colour, interlace] = [0, 0, 0, 0, 0];
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") [width, height, depth, colour, interlace] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8]!, body[9]!, body[12]!];
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) throw new Error(`unsupported PNG (depth ${depth}, colour ${colour}, interlace ${interlace})`);
  const bpp = colour === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x]!;
      const left = x >= bpp ? rows[y * stride + x - bpp]! : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? rows[(y - 1) * stride + x - bpp]! : 0;
      const add = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
      rows[y * stride + x] = (cur + add) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let k = 0; k < 3; k++) data[i * 4 + k] = rows[i * bpp + k]!;
    data[i * 4 + 3] = colour === 6 ? rows[i * bpp + 3]! : 255;
  }
  return { width, height, data };
}
