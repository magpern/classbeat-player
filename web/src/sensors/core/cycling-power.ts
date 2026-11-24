// Cycling Power Measurement 0x2A63: flags u16, power s16 (W), then the optional fields in order.
import type { Crank } from "./crank.ts";
import { bit, walk } from "./walk.ts";

export function parseCyclingPower(dv: DataView): { watts: number; crank?: Crank } | null {
  if (dv.byteLength < 4) return null;
  const f = dv.getUint16(0, true);
  const w = walk(dv, 4, [
    ["balance", bit(f, 0), 1], ["torque", bit(f, 2), 2], ["wheel", bit(f, 4), 6], ["crank", bit(f, 5), 4],
    ["force", bit(f, 6), 4], ["torqueX", bit(f, 7), 4], ["angles", bit(f, 8), 3], ["top", bit(f, 9), 2],
    ["bottom", bit(f, 10), 2], ["energy", bit(f, 11), 2],
  ]);
  if (!w) return null;
  const watts = dv.getInt16(2, true);
  const c = w.at.crank;
  return c === undefined ? { watts } : { watts, crank: { revs: dv.getUint16(c, true), time: dv.getUint16(c + 2, true) } };
}
