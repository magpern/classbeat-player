// Where things go in a QR code symbol (ISO/IEC 18004): the finder, timing and alignment patterns,
// the format and version information, the data modules' zigzag path and the eight masks. Pure: no
// I/O. Error correction is fixed at M (format bits 00).

export type Grid = boolean[][];

export interface QrSymbol {
  readonly version: number;
  readonly size: number;
  readonly modules: Grid;
  /** True where a module belongs to a function pattern, not to the data. */
  readonly reserved: Grid;
}

const ECC_M_BITS = 0;

/** Bit i of x. */
const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

/** The centres of the alignment patterns along one axis. */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const size = version * 4 + 17;
  const out = [6];
  for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** The 15 format bits for error correction M and this mask, with their BCH code and XOR mask. */
export function formatBits(mask: number): number {
  const data = (ECC_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up) with their BCH code. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function grid(size: number): Grid {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => false));
}

/** A symbol with every function pattern drawn and the format area reserved (drawn for mask 0). */
export function blankSymbol(version: number): QrSymbol {
  const size = version * 4 + 17;
  const s: QrSymbol = { version, size, modules: grid(size), reserved: grid(size) };
  const set = (x: number, y: number, dark: boolean): void => {
    s.modules[y][x] = dark;
    s.reserved[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  const align = alignmentPositions(version);
  const last = align.length - 1;
  align.forEach((cy, i) =>
    align.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  drawFormat(s, 0);
  if (version >= 7) {
    const v = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(v, i));
      set(b, a, bit(v, i));
    }
  }
  return s;
}

/** Draws the format bits for this mask, both copies, and the dark module. */
export function drawFormat(s: QrSymbol, mask: number): void {
  const f = formatBits(mask);
  const n = s.size;
  const set = (x: number, y: number, dark: boolean): void => {
    s.modules[y][x] = dark;
    s.reserved[y][x] = true;
  };
  for (let i = 0; i <= 5; i++) set(8, i, bit(f, i));
  set(8, 7, bit(f, 6));
  set(8, 8, bit(f, 7));
  set(7, 8, bit(f, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(f, i));
  for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(f, i));
  for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(f, i));
  set(8, n - 8, true);
}

/** The data modules in placement order: two-module columns from the right, up then down, skipping column 6. */
export function dataPath(s: QrSymbol): [number, number][] {
  const out: [number, number][] = [];
  for (let right = s.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < s.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? s.size - 1 - vert : vert;
        if (!s.reserved[y][x]) out.push([x, y]);
      }
    }
  }
  return out;
}

/** Whether mask pattern `mask` (0 to 7) inverts the module at column x, row y. */
export function masked(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** Inverts every data module that the mask selects (applying it twice undoes it). */
export function applyMask(s: QrSymbol, mask: number): void {
  for (let y = 0; y < s.size; y++) for (let x = 0; x < s.size; x++) if (!s.reserved[y][x] && masked(mask, x, y)) s.modules[y][x] = !s.modules[y][x];
}
