// The class code's QR code (room-2d.md, "The class code"): `https://<site>/control#<join code>` as
// a version 3 code, 29 by 29 modules, the size the band's QR box and check C10 are drawn for. Byte
// mode, error correction M where the address fits and L otherwise; the mask with the lowest
// penalty (ISO/IEC 18004, section 7.8.3). Pure: it returns the modules, the page draws them.
import { formatBits, rsDivisor, rsRemainder } from "./qr-ecc.ts";
import type { Level } from "./qr-ecc.ts";

export const QR_SIZE = 29;
/** The light border every reader needs around the modules (4 modules on each side). */
export const QR_QUIET = 4;

/** Version 3 in one block: data and error correction codewords per level. */
const BLOCKS: Readonly<Record<Level, { data: number; ec: number }>> = { M: { data: 44, ec: 26 }, L: { data: 55, ec: 15 } };

export interface QrCode {
  readonly level: Level;
  readonly mask: number;
  /** Rows of modules, top first; true is dark. */
  readonly modules: readonly (readonly boolean[])[];
}

type Grid = boolean[][];

const grid = (): Grid => Array.from({ length: QR_SIZE }, () => Array.from({ length: QR_SIZE }, () => false));

/** The codewords for `bytes`: byte mode, an 8-bit count, the terminator and the pad bytes. */
function codewords(bytes: readonly number[], level: Level): number[] | null {
  const { data, ec } = BLOCKS[level];
  if (bytes.length > data - 2) return null;
  const bits: number[] = [];
  const put = (v: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, data * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < data; pad ^= 0xec ^ 0x11) out.push(pad);
  return [...out, ...rsRemainder(out, rsDivisor(ec))];
}

/** Finders, separators, timing, the one alignment pattern, the dark module and the format areas. */
function functionPatterns(): { dark: Grid; fixed: Grid } {
  const dark = grid();
  const fixed = grid();
  const set = (x: number, y: number, on: boolean): void => {
    if (x < 0 || y < 0 || x >= QR_SIZE || y >= QR_SIZE) return;
    dark[y]![x] = on;
    fixed[y]![x] = true;
  };
  for (let i = 0; i < QR_SIZE; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [QR_SIZE - 4, 3], [3, QR_SIZE - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, d !== 2 && d !== 4);
    }
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(22 + dx, 22 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  // The format areas are reserved now and written with the mask.
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue;
    set(8, i, false);
    set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(QR_SIZE - 1 - i, 8, false);
    set(8, QR_SIZE - 1 - i, false);
  }
  set(8, QR_SIZE - 8, true);
  return { dark, fixed };
}

function writeFormat(dark: Grid, level: Level, mask: number): void {
  const bits = formatBits(level, mask);
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
  const at = (x: number, y: number, on: boolean): void => void (dark[y]![x] = on);
  for (let i = 0; i <= 5; i++) at(8, i, bit(i));
  at(8, 7, bit(6));
  at(8, 8, bit(7));
  at(7, 8, bit(8));
  for (let i = 9; i < 15; i++) at(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) at(QR_SIZE - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) at(8, QR_SIZE - 15 + i, bit(i));
  at(8, QR_SIZE - 8, true);
}

/** The codewords in the two-column zigzag, right to left, skipping the timing column. */
function placeData(dark: Grid, fixed: Grid, words: readonly number[]): void {
  let i = 0;
  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < QR_SIZE; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? QR_SIZE - 1 - vert : vert;
        if (fixed[y]![x] || i >= words.length * 8) continue;
        dark[y]![x] = ((words[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function masked(dark: Grid, fixed: Grid, mask: number): Grid {
  return dark.map((row, y) => row.map((on, x) => (fixed[y]![x] ? on : on !== MASKS[mask]!(x, y))));
}

/** The penalty of section 7.8.3: runs, 2×2 blocks, finder-like patterns and the dark share. */
export function penalty(m: readonly (readonly boolean[])[]): number {
  const n = m.length;
  const lines: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    lines.push([...m[i]!]);
    lines.push(m.map((row) => row[i]!));
  }
  let score = 0;
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    const s = line.map((v) => (v ? "1" : "0")).join("");
    for (const p of ["10111010000", "00001011101"]) for (let k = s.indexOf(p); k !== -1; k = s.indexOf(p, k + 1)) score += 40;
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y]![x];
    if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
  }
  const darkCount = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs(darkCount * 20 - n * n * 10) / (n * n)) * 10;
  return score;
}

/** The QR code of `text` (ASCII), or null when it does not fit version 3 at level L. `mask` forces one (tests). */
export function qrCode(text: string, mask?: number): QrCode | null {
  const bytes = [...text].map((c) => c.charCodeAt(0));
  if (bytes.some((b) => b > 0x7e || b < 0x20)) return null;
  for (const level of ["M", "L"] as const) {
    const words = codewords(bytes, level);
    if (!words) continue;
    const { dark, fixed } = functionPatterns();
    placeData(dark, fixed, words);
    const tryMask = (k: number): Grid => {
      const g = masked(dark, fixed, k);
      writeFormat(g, level, k);
      return g;
    };
    const masks = mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask];
    let best = { mask: masks[0]!, modules: tryMask(masks[0]!), score: Infinity };
    for (const k of masks) {
      const g = tryMask(k);
      const s = penalty(g);
      if (s < best.score) best = { mask: k, modules: g, score: s };
    }
    return { level, mask: best.mask, modules: best.modules };
  }
  return null;
}
