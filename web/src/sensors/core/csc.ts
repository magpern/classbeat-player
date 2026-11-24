// CSC Measurement 0x2A5B: flags u8 (bit0 wheel data u32+u16, bit1 crank data u16+u16).
import type { Crank } from "./crank.ts";
import { bit, walk } from "./walk.ts";

export function parseCsc(dv: DataView): { crank?: Crank } | null {
  if (dv.byteLength < 1) return null;
  const f = dv.getUint8(0);
  const w = walk(dv, 1, [["wheel", bit(f, 0), 6], ["crank", bit(f, 1), 4]]);
  if (!w) return null;
  const c = w.at.crank;
  return c === undefined ? {} : { crank: { revs: dv.getUint16(c, true), time: dv.getUint16(c + 2, true) } };
}
