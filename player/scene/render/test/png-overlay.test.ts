// The whole-frame gate's tools (tools/png.ts, tools/text-overlay.ts): the PNG reader with every row filter, and the
// text layer's overlay: a canvas pixel under it blends as the browser blends it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { decodePng } from "../tools/png.ts";
import { blend, overlayOf } from "../tools/text-overlay.ts";

function crc(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}
/** A PNG of `width` x `height` pixels of `bpp` channels, each row written with the filter `filters[y % filters.length]`. */
function encode(width: number, height: number, bpp: 3 | 4, pixels: number[], filters: number[]): Buffer {
  const stride = width * bpp;
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    const f = filters[y % filters.length]!;
    rows.push(f);
    for (let x = 0; x < stride; x++) {
      const cur = pixels[y * stride + x]!;
      const left = x >= bpp ? pixels[y * stride + x - bpp]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[(y - 1) * stride + x - bpp]! : 0;
      const p = left + up - upLeft;
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      const predicted = f === 0 ? 0 : f === 1 ? left : f === 2 ? up : f === 3 ? (left + up) >> 1 : paeth;
      rows.push((cur - predicted) & 0xff);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  [ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]] = [8, bpp === 4 ? 6 : 2, 0, 0, 0];
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}

test("the reader gives back every pixel under each of the five row filters, RGB and RGBA", () => {
  for (const bpp of [3, 4] as const) {
    const [w, h] = [7, 6];
    const pixels = Array.from({ length: w * h * bpp }, (_, i) => (i * 37 + (i % 5) * 91) & 0xff);
    const got = decodePng(encode(w, h, bpp, pixels, [0, 1, 2, 3, 4, 2]));
    assert.equal(got.width, w);
    assert.equal(got.height, h);
    for (let i = 0; i < w * h; i++) {
      for (let k = 0; k < 3; k++) assert.equal(got.data[i * 4 + k], pixels[i * bpp + k], `pixel ${i}`);
      assert.equal(got.data[i * 4 + 3], bpp === 4 ? pixels[i * 4 + 3] : 255);
    }
  }
});

test("a file that is not a PNG, or one in a form the reader does not take, is refused", () => {
  assert.throws(() => decodePng(Buffer.from("not a png at all")), /not a PNG/);
});

test("the overlay is the colour over black and the opacity from the two screenshots, and a canvas pixel shows through by what is left", () => {
  const px = (rgb: [number, number, number]) => ({ width: 1, height: 1, data: new Uint8Array([...rgb, 255]) });
  // A half-opaque layer of colour (200, 100, 0): over black 100, 50, 0; over white 100 + 127.5, 50 + 127.5, 127.5.
  const over = overlayOf(px([100, 50, 0]), px([228, 178, 128]));
  assert.deepEqual([...over].slice(0, 3), [100, 50, 0]);
  assert.ok(Math.abs(over[3]! - 128) <= 1, `opacity ${over[3]}`);
  const shown = blend([over[0]!, over[1]!, over[2]!, over[3]!], [60, 60, 60]);
  assert.ok(shown.every((v, i) => Math.abs(v - [130, 80, 30][i]!) <= 1), `blended ${shown.join(", ")}`);
  // Opaque text is its own colour, and a pixel the layer does not touch is the canvas's.
  assert.deepEqual([...overlayOf(px([10, 20, 30]), px([10, 20, 30]))].slice(3), [255]);
  assert.deepEqual([...overlayOf(px([0, 0, 0]), px([255, 255, 255]))].slice(3), [0]);
  assert.deepEqual(blend([0, 0, 0, 0], [12, 34, 56]), [12, 34, 56]);
});
