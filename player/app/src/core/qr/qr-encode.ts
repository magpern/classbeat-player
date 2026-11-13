// A QR code encoder (ISO/IEC 18004, Model 2): byte mode, error correction M, the smallest version
// that fits, and the mask with the lowest penalty unless one is asked for. Pure: no I/O. Used for
// the presenter's control link (ADR 0005 section 3); it knows nothing about what it encodes.
import { applyMask, blankSymbol, dataPath, drawFormat } from "./qr-layout.ts";
import type { QrSymbol } from "./qr-layout.ts";
import { penalty } from "./qr-penalty.ts";
import { rsDivisor, rsRemainder } from "./reed-solomon.ts";

export interface QrCode {
  readonly version: number;
  readonly mask: number;
  /** Modules per side, without the quiet zone. */
  readonly size: number;
  /** rows[y][x]: true is dark. */
  readonly rows: readonly (readonly boolean[])[];
}

// Error correction M, per version (index 0 unused): codewords per block and number of blocks.
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

/** Data and error-correction modules of a version: everything outside the function patterns. */
export function rawModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

export function dataCodewords(version: number): number {
  return Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];
}

/** The data codewords: mode 0100, the length, the bytes, the terminator and the pad bytes. */
function dataBytes(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(version) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < capacity / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Splits the data into blocks, adds each block's error correction and interleaves them. */
export function interleave(data: readonly number[], version: number): number[] {
  const blocks = BLOCKS[version];
  const eccLen = ECC_PER_BLOCK[version];
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const block = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += block.length;
    const ecc = rsRemainder(block, divisor);
    if (i < shortBlocks) block.push(0);
    all.push(block.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < all[0].length; i++) {
    all.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i]);
    });
  }
  return out;
}

function place(version: number, codewords: readonly number[], mask: number): QrSymbol {
  const s = blankSymbol(version);
  dataPath(s).forEach(([x, y], i) => {
    s.modules[y][x] = i < codewords.length * 8 && ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
  });
  applyMask(s, mask);
  drawFormat(s, mask);
  return s;
}

/** The QR code of this text (UTF-8). Throws if it does not fit in version 40. */
export function encodeQr(text: string, opts: { readonly mask?: number } = {}): QrCode {
  if (opts.mask !== undefined && !(Number.isInteger(opts.mask) && opts.mask >= 0 && opts.mask <= 7)) throw new RangeError("a mask is 0 to 7");
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= 40 && 4 + (version < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8) version++;
  if (version > 40) throw new RangeError("too long for a QR code");
  const codewords = interleave(dataBytes(bytes, version), version);
  const masks = opts.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [opts.mask];
  let best: { mask: number; s: QrSymbol; score: number } | null = null;
  for (const mask of masks) {
    const s = place(version, codewords, mask);
    const score = masks.length === 1 ? 0 : penalty(s.modules);
    if (best === null || score < best.score) best = { mask, s, score };
  }
  const chosen = best as { mask: number; s: QrSymbol };
  return { version, mask: chosen.mask, size: chosen.s.size, rows: chosen.s.modules };
}
