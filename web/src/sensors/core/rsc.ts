// Running Speed and Cadence Measurement 0x2A53 (a foot pod): flags u8 (bit0 stride length u16,
// bit1 total distance u32, bit2 running), then speed u16 in 1/256 m/s and cadence u8 in steps a
// minute. Total distance is skipped, never decoded (ADR 0015).
import { bit, walk } from "./walk.ts";

export interface RscData {
  /** Instantaneous speed, km/h. */
  readonly kmh: number;
  /** Steps a minute: a foot pod's own kind, never a bike's rpm. */
  readonly stepsPerMin: number;
}

export function parseRsc(dv: DataView): RscData | null {
  if (dv.byteLength < 4) return null;
  const f = dv.getUint8(0);
  if (!walk(dv, 4, [["stride", bit(f, 0), 2], ["distance", bit(f, 1), 4]])) return null;
  return { kmh: (dv.getUint16(1, true) / 256) * 3.6, stepsPerMin: dv.getUint8(3) };
}
