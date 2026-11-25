// Treadmill Data 0x2ACD (Fitness Machine Service): flags u16, bit0 is "more data" so the
// instantaneous speed is present when it is 0. Only speed and inclination are decoded. Every
// other field is skipped by its flag; total distance is never decoded into a value (ADR 0015).
import { bit, walk } from "./walk.ts";

export interface TreadmillData {
  /** Instantaneous speed, km/h. */
  readonly kmh?: number;
  /** Inclination, percent. */
  readonly inclinePct?: number;
}

// What a device sends for "inclination not available".
const NO_INCLINE = 32767;

export function parseTreadmill(dv: DataView): TreadmillData | null {
  if (dv.byteLength < 2) return null;
  const f = dv.getUint16(0, true);
  const w = walk(dv, 2, [
    ["speed", !bit(f, 0), 2], ["avgSpeed", bit(f, 1), 2], ["distance", bit(f, 2), 3],
    ["incline", bit(f, 3), 4], // inclination s16 then ramp angle s16
    ["elevation", bit(f, 4), 4], ["pace", bit(f, 5), 1], ["avgPace", bit(f, 6), 1],
    ["energy", bit(f, 7), 5], ["hr", bit(f, 8), 1], ["met", bit(f, 9), 1],
    ["elapsed", bit(f, 10), 2], ["remaining", bit(f, 11), 2], ["belt", bit(f, 12), 4],
  ]);
  if (!w) return null;
  const { speed, incline } = w.at;
  const pct = incline === undefined ? NO_INCLINE : dv.getInt16(incline, true);
  return {
    ...(speed !== undefined && { kmh: dv.getUint16(speed, true) / 100 }),
    ...(pct !== NO_INCLINE && { inclinePct: pct / 10 }),
  };
}
