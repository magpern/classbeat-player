// Heart Rate Measurement 0x2A37: flags u8 (bit0: 16-bit value, bit3: energy, bit4: RR intervals).
import { bit, walk } from "./walk.ts";

export function parseHeartRate(dv: DataView): { bpm: number } | null {
  if (dv.byteLength < 2) return null;
  const f = dv.getUint8(0);
  const wide = bit(f, 0);
  // RR intervals (u16, one or more) are required when flagged but not read; trailing bytes are ignored.
  if (!walk(dv, 1, [["bpm", true, wide ? 2 : 1], ["energy", bit(f, 3), 2], ["rr", bit(f, 4), 2]])) return null;
  return { bpm: wide ? dv.getUint16(1, true) : dv.getUint8(1) };
}
