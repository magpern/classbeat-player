// readings_model: what the rider's sensors give, held in memory only (ADR 0012 sections 3 and 4;
// docs/design/sensors.md, "What a reading is"). Pure: the source's events in, the state out.
//
// - A reading is a whole number in its range (heart rate 30 to 250, cadence 0 to 250, power 0 to
//   2000); anything else is not a reading.
// - One source per measure: the device connected first that gives it. If that one is lost, the
//   measure has no value (no silent switch to another device); Reconnect or Disconnect lets the
//   next one take it.
// - Nothing here is stored, sent or compared.
import type { Stamped } from "./freshness.ts";
import { fresh, FRESH_MS } from "./freshness.ts";
import { usedForRun, withRunSample } from "./run-readings.ts";
import type { RunMeasure } from "./running.ts";

export type Measure = "hr" | "power" | "cadence";
export const MEASURES: readonly Measure[] = ["power", "hr", "cadence"];

const RANGES: Readonly<Record<Measure, readonly [number, number]>> = { hr: [30, 250], cadence: [0, 250], power: [0, 2000] };

/** The whole-number reading, or null when the value is not one (outside its range, not finite). */
export function reading(m: Measure, v: number): number | null {
  if (!Number.isFinite(v)) return null;
  const r = Math.round(v);
  const [lo, hi] = RANGES[m];
  return r >= lo && r <= hi ? r : null;
}

export interface Device {
  readonly id: string;
  readonly name: string;
  readonly gives: readonly Measure[];
  /** What a treadmill or foot pod gives (ADR 0015): apart from `gives`, so a foot pod's steps a minute is never a bike's rpm. */
  readonly runs: readonly RunMeasure[];
  readonly lost: boolean;
  /** When it connected, on the source's clock. */
  readonly since: number;
}

export type SensorEvent =
  | { readonly type: "choosing" }
  /** The browser's list closed with nothing picked: not a failure, nothing to say. */
  | { readonly type: "closed" }
  | { readonly type: "failed" }
  | { readonly type: "connected"; readonly id: string; readonly name: string; readonly gives: readonly Measure[]; readonly runs?: readonly RunMeasure[]; readonly at: number }
  | { readonly type: "lost"; readonly id: string }
  /** Reconnect pressed: the device goes to the back of the line, so another may take its measures. */
  | { readonly type: "retry"; readonly id: string }
  | { readonly type: "removed"; readonly id: string }
  | { readonly type: "sample"; readonly id: string; readonly measure: Measure; readonly value: number; readonly at: number }
  /** A treadmill's or foot pod's reading (ADR 0015 section 3). */
  | { readonly type: "run_sample"; readonly id: string; readonly measure: RunMeasure; readonly value: number; readonly at: number };

export interface Sensors {
  readonly choosing: boolean;
  readonly failed: boolean;
  /** In the order they take a measure: the first connected first. */
  readonly devices: readonly Device[];
  readonly samples: Readonly<Record<string, Partial<Record<Measure, Stamped<number>>>>>;
  readonly runSamples: Readonly<Record<string, Partial<Record<RunMeasure, Stamped<number>>>>>;
}

export const NO_SENSORS: Sensors = { choosing: false, failed: false, devices: [], samples: {}, runSamples: {} };

const without = (s: Sensors, id: string): readonly Device[] => s.devices.filter((d) => d.id !== id);

/** The state without a device's readings (a new connection, a loss, a removal). */
function dropSamples(s: Sensors, id: string): Pick<Sensors, "samples" | "runSamples"> {
  const samples = { ...s.samples };
  const runSamples = { ...s.runSamples };
  delete samples[id];
  delete runSamples[id];
  return { samples, runSamples };
}

export function step(s: Sensors, e: SensorEvent): Sensors {
  switch (e.type) {
    case "choosing":
      return { ...s, choosing: true, failed: false };
    case "closed":
      return { ...s, choosing: false };
    case "failed":
      return { ...s, choosing: false, failed: true };
    case "connected": {
      const d: Device = { id: e.id, name: e.name, gives: e.gives, runs: e.runs ?? [], lost: false, since: e.at };
      return { ...s, choosing: false, failed: false, devices: [...without(s, e.id), d], ...dropSamples(s, e.id) };
    }
    case "lost":
      return { ...s, devices: s.devices.map((d) => (d.id === e.id ? { ...d, lost: true } : d)), ...dropSamples(s, e.id) };
    case "retry": {
      const d = s.devices.find((x) => x.id === e.id);
      return d ? { ...s, devices: [...without(s, e.id), d] } : s;
    }
    case "removed":
      return { ...s, devices: without(s, e.id), ...dropSamples(s, e.id) };
    case "sample": {
      const d = s.devices.find((x) => x.id === e.id);
      const v = reading(e.measure, e.value);
      if (!d || d.lost || v === null) return s;
      const devices = d.gives.includes(e.measure) ? s.devices : s.devices.map((x) => (x === d ? { ...d, gives: [...d.gives, e.measure] } : x));
      return { ...s, devices, samples: { ...s.samples, [e.id]: { ...s.samples[e.id], [e.measure]: { value: v, at: e.at } } } };
    }
    case "run_sample":
      return withRunSample(s, e.id, e.measure, e.value, e.at);
  }
}

/** The device that takes a measure: the first that gives it, lost or not. */
export const usedFor = (s: Sensors, m: Measure): Device | null => s.devices.find((d) => d.gives.includes(m)) ?? null;

export interface MeasureNow {
  /** The device that takes it; null when no connected device gives it. */
  readonly device: Device | null;
  readonly value: number | null;
  /** Connected for longer than the hold and still no value (a strap off the skin, a bike not pedalled). */
  readonly missing: boolean;
}

export function measureNow(s: Sensors, m: Measure, now: number): MeasureNow {
  const device = usedFor(s, m);
  if (!device) return { device: null, value: null, missing: false };
  const value = device.lost ? null : fresh(s.samples[device.id]?.[m], now);
  return { device, value, missing: !device.lost && value === null && now - device.since > FRESH_MS };
}

export type SourceState = "unsupported" | "idle" | "choosing" | "connected" | "lost";

export function sourceState(s: Sensors, supported: boolean): SourceState {
  if (!supported) return "unsupported";
  if (s.choosing) return "choosing";
  if (s.devices.some((d) => d.lost)) return "lost";
  return s.devices.length ? "connected" : "idle";
}

type Given = Measure | RunMeasure;
const NAMES: Readonly<Record<Given, string>> = { hr: "heart rate", power: "power", cadence: "cadence", speed: "speed", incline: "incline", stepCadence: "cadence" };
const ORDER: readonly Given[] = ["hr", "power", "cadence", "speed", "incline", "stepCadence"];

/** "Heart rate", "Power and cadence", "Power, cadence and heart rate". */
export function measureWords(ms: readonly Given[]): string {
  const w = [...ms].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((m) => NAMES[m]);
  const text = w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}` : (w[0] ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A device's state in words, as the sensors sheet shows it. */
export function deviceWords(s: Sensors, d: Device): string {
  const what = measureWords([...d.gives, ...d.runs]);
  const taken = [...d.gives.map((m) => usedFor(s, m)), ...d.runs.map((m) => usedForRun(s, m))];
  const state = d.lost ? "lost" : taken.length && taken.every((u) => u !== d) ? "connected, not used" : "connected";
  return what ? `${what}, ${state}` : state.charAt(0).toUpperCase() + state.slice(1);
}
