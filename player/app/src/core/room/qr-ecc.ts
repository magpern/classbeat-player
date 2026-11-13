// The error correction of the class code's QR code (ISO/IEC 18004): Reed-Solomon over GF(256)
// with the polynomial 0x11D, and the BCH code of the 15 format bits. Pure.

/** a × b in GF(256) modulo x^8 + x^4 + x^3 + x^2 + 1. */
function multiply(a: number, b: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((b >>> i) & 1) * a;
  }
  return z & 0xff;
}

/** The generator polynomial of the given degree, highest coefficient (always 1) left out. */
export function rsDivisor(degree: number): number[] {
  const result: number[] = Array.from({ length: degree }, () => 0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j]!, root);
      if (j + 1 < degree) result[j] ^= result[j + 1]!;
    }
    root = multiply(root, 0x02);
  }
  return result;
}

/** The error correction codewords of `data` for a generator from rsDivisor. */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= multiply(coef, factor)));
  }
  return result;
}

/** The error correction level's two bits in the format information (L 01, M 00). */
export const LEVEL_BITS = { L: 1, M: 0 } as const;
export type Level = keyof typeof LEVEL_BITS;

/** The 15 format bits: level and mask, their BCH(15,5) code, masked with 0x5412. */
export function formatBits(level: Level, mask: number): number {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
