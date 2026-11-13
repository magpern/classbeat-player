// A small QR code reader for the tests, written apart from the encoder (src/core/qr/) so that it
// checks it rather than repeats it: its own tables from ISO/IEC 18004 (alignment centres, error
// correction M blocks), its own log-table field arithmetic, and it counts the data modules
// instead of computing them. It reads a clean module grid (no image processing), checks both
// copies of the format information and every block's Reed-Solomon syndromes, the terminator and
// the pad bytes, and returns the byte-mode text. Versions 1 to 14, error correction M only.

// Alignment pattern centres, ISO/IEC 18004 Annex E, versions 1 to 14.
const ALIGN: readonly (readonly number[])[] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46],
  [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
];
// Error correction M, ISO/IEC 18004 Table 9: [blocks, error-correction codewords per block].
const ECC_M: readonly (readonly [number, number])[] = [
  [0, 0], [1, 10], [1, 16], [1, 26], [2, 18], [2, 24], [4, 16], [4, 18], [4, 22], [5, 22],
  [5, 26], [5, 30], [8, 22], [9, 22], [9, 24],
];

export interface Decoded {
  readonly version: number;
  readonly mask: number;
  readonly text: string;
}

const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function fail(why: string): never {
  throw new Error(`QR: ${why}`);
}

/** The 15-bit format word for M and this mask, by polynomial division (Annex C). */
function formatWord(mask: number): number {
  const data = mask; // M is 00
  let r = data << 10;
  for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10);
  return ((data << 10) | r) ^ 0x5412;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (y + x) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (y + x) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (x, y) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (x, y) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

function functionArea(version: number, n: number): boolean[][] {
  const f = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const box = (x0: number, y0: number, w: number, h: number): void => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) f[y][x] = true;
  };
  box(0, 0, 9, 9); // finder, separator and format, top left
  box(n - 8, 0, 8, 9);
  box(0, n - 8, 9, 8);
  box(6, 0, 1, n);
  box(0, 6, n, 1);
  // Every pair of centres, except the three that would overlap a finder.
  const a = ALIGN[version];
  const end = a[a.length - 1];
  for (const cy of a) for (const cx of a) if (!((cx === 6 && cy === 6) || (cx === 6 && cy === end) || (cx === end && cy === 6))) box(cx - 2, cy - 2, 5, 5);
  if (version >= 7) {
    box(n - 11, 0, 3, 6);
    box(0, n - 11, 6, 3);
  }
  return f;
}

export function decodeQr(rows: readonly (readonly boolean[])[]): Decoded {
  const n = rows.length;
  if (rows.some((r) => r.length !== n)) fail("not square");
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 14) fail(`size ${n}`);
  const at = (x: number, y: number): number => (rows[y][x] ? 1 : 0);
  // Format information, both copies (Figure 25), bit 14 first.
  const a: [number, number][] = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
  const b: [number, number][] = [];
  for (let i = 0; i < 7; i++) b.push([8, n - 1 - i]);
  for (let i = 0; i < 8; i++) b.push([n - 8 + i, 8]);
  const word = (pos: [number, number][]): number => pos.reduce((w, [x, y]) => (w << 1) | at(x, y), 0);
  const fa = word(a);
  if (fa !== word(b)) fail("the two format copies differ");
  const mask = [0, 1, 2, 3, 4, 5, 6, 7].find((m) => formatWord(m) === fa);
  if (mask === undefined) fail("format is not error correction M");
  if (at(8, n - 8) !== 1) fail("no dark module");
  // Data modules, upward and downward in two-module columns from the right.
  const f = functionArea(version, n);
  const bits: number[] = [];
  let up = true;
  for (let x = n - 1; x > 0; x -= 2) {
    if (x === 6) x--;
    for (let k = 0; k < n; k++) {
      const y = up ? n - 1 - k : k;
      for (const xx of [x, x - 1]) if (!f[y][xx]) bits.push(at(xx, y) ^ (MASKS[mask](xx, y) ? 1 : 0));
    }
    up = !up;
  }
  const total = Math.floor(bits.length / 8);
  const codewords: number[] = [];
  for (let i = 0; i < total; i++) codewords.push(bits.slice(i * 8, i * 8 + 8).reduce((v, x) => (v << 1) | x, 0));
  // Undo the interleaving: shorter blocks first, then the longer ones with one more data codeword.
  const [blocks, ecc] = ECC_M[version];
  const dataTotal = total - blocks * ecc;
  const short = Math.floor(dataTotal / blocks);
  const longCount = dataTotal % blocks;
  const lens = Array.from({ length: blocks }, (_, i) => short + (i >= blocks - longCount ? 1 : 0));
  const parts = lens.map(() => [] as number[]);
  let k = 0;
  for (let i = 0; i < short + 1; i++) for (let j = 0; j < blocks; j++) if (i < lens[j]) parts[j].push(codewords[k++]);
  for (let i = 0; i < ecc; i++) for (let j = 0; j < blocks; j++) parts[j].push(codewords[k++]);
  if (k !== total) fail("codeword count");
  for (const p of parts) {
    for (let i = 0; i < ecc; i++) {
      const s = p.reduce((acc, c) => mul(acc, EXP[i]) ^ c, 0);
      if (s !== 0) fail("a Reed-Solomon syndrome is not zero");
    }
  }
  const data = parts.flatMap((p, j) => p.slice(0, lens[j]));
  const stream = data.flatMap((c) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (c >>> i) & 1));
  let pos = 0;
  const read = (len: number): number => {
    let v = 0;
    for (let i = 0; i < len; i++) v = (v << 1) | stream[pos++];
    return v;
  };
  if (read(4) !== 0b0100) fail("not byte mode");
  const count = read(version < 10 ? 8 : 16);
  const bytes = Array.from({ length: count }, () => read(8));
  const term = Math.min(4, stream.length - pos);
  if (read(term) !== 0) fail("terminator");
  while (pos % 8 !== 0) if (read(1) !== 0) fail("bit padding");
  for (let pad = 0xec; pos < stream.length; pad ^= 0xec ^ 0x11) if (read(8) !== pad) fail("pad bytes");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  return { version, mask, text };
}
