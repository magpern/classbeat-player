// The allowlist of ADR 0012, section 1: the only services and characteristics sensor code names.
// Read by notification only. Nothing that writes or controls is named anywhere (rule 2).
export const SERVICES = {
  heartRate: 0x180d,
  cyclingSpeedCadence: 0x1816,
  cyclingPower: 0x1818,
  fitnessMachine: 0x1826,
} as const;

export const CHARACTERISTICS = {
  heartRateMeasurement: 0x2a37,
  cscMeasurement: 0x2a5b,
  cyclingPowerMeasurement: 0x2a63,
  indoorBikeData: 0x2ad2,
} as const;

/** The 128-bit form of a 16-bit assigned number. */
export function uuid128(short: number): string {
  return `0000${short.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;
}
