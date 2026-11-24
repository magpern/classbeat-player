// Indoor Bike Data 0x2AD2: flags u16 (bit0 is "more data", so speed is present when it is 0),
// then the fields in the order of the Fitness Machine Service spec.
import { bit, walk } from "./walk.ts";

export interface BikeData {
  readonly cadence?: number;
  readonly watts?: number;
  readonly bpm?: number;
}

export function parseIndoorBike(dv: DataView): BikeData | null {
  if (dv.byteLength < 2) return null;
  const f = dv.getUint16(0, true);
  const w = walk(dv, 2, [
    ["speed", !bit(f, 0), 2], ["avgSpeed", bit(f, 1), 2], ["cadence", bit(f, 2), 2], ["avgCadence", bit(f, 3), 2],
    ["distance", bit(f, 4), 3], ["resistance", bit(f, 5), 2], ["power", bit(f, 6), 2], ["avgPower", bit(f, 7), 2],
    ["energy", bit(f, 8), 5], ["hr", bit(f, 9), 1], ["met", bit(f, 10), 1], ["elapsed", bit(f, 11), 2],
    ["remaining", bit(f, 12), 2],
  ]);
  if (!w) return null;
  const { cadence, power, hr } = w.at;
  return {
    ...(cadence !== undefined && { cadence: dv.getUint16(cadence, true) / 2 }),
    ...(power !== undefined && { watts: dv.getInt16(power, true) }),
    ...(hr !== undefined && { bpm: dv.getUint8(hr) }),
  };
}
