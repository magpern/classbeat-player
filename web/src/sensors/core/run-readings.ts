// run_readings: the treadmill's and the foot pod's readings, held in memory only (ADR 0015 sections 4
// and 5; docs/design/running-class.md, "The readings"). Pure. Like the bike's, with the same rules:
// one source per measure (the first connected device that gives it), a reading held for at most
// 3 s (`FRESH_MS`) and then missing, never the last number. Nothing here is stored or sent.
import { fresh } from "./freshness.ts";
import type { Device, Sensors } from "./readings.ts";
import { runReading } from "./running.ts";
import type { RunMeasure } from "./running.ts";

export const RUN_MEASURES: readonly RunMeasure[] = ["speed", "incline", "stepCadence"];

/** The state with a running reading in it; a lost or unknown device, or a value out of range, changes nothing. */
export function withRunSample(s: Sensors, id: string, measure: RunMeasure, value: number, at: number): Sensors {
  const d = s.devices.find((x) => x.id === id);
  const v = runReading(measure, value);
  if (!d || d.lost || v === null) return s;
  const devices = d.runs.includes(measure) ? s.devices : s.devices.map((x) => (x === d ? { ...d, runs: [...d.runs, measure] } : x));
  return { ...s, devices, runSamples: { ...s.runSamples, [id]: { ...s.runSamples[id], [measure]: { value: v, at } } } };
}

/** The device that takes a running measure: the first that gives it, lost or not. */
export const usedForRun = (s: Sensors, m: RunMeasure): Device | null => s.devices.find((d) => d.runs.includes(m)) ?? null;

export interface RunNow {
  /** The device that takes it; null when no connected device gives it (the row is not shown). */
  readonly device: Device | null;
  /** The reading if it is at most 3 s old, else null. */
  readonly value: number | null;
}

export function runNow(s: Sensors, m: RunMeasure, now: number): RunNow {
  const device = usedForRun(s, m);
  if (!device) return { device: null, value: null };
  return { device, value: device.lost ? null : fresh(s.runSamples[device.id]?.[m], now) };
}

/** Speed and incline to one decimal ("9.5", "1.0"), steps a minute as a whole number ("164"); a dash for no value. */
export function runText(m: RunMeasure, v: number | null): string {
  if (v === null) return "–";
  return m === "stepCadence" ? String(Math.round(v)) : v.toFixed(1);
}

export const RUN_LABELS: Readonly<Record<RunMeasure, string>> = { speed: "Speed", incline: "Incline", stepCadence: "Cadence" };
export const RUN_UNITS: Readonly<Record<RunMeasure, string>> = { speed: "km/h", incline: "%", stepCadence: "steps/min" };
