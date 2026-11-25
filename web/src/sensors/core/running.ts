// running_model: a treadmill or foot-pod notification into readings (ADR 0015 sections 3 and 4).
// Pure: the bytes in, the readings out. These kinds are apart from the bike's `Measure`, so a
// foot pod's steps a minute can never stand in for a bike's rpm or be gauged against an rpm target.
import { parseRsc } from "./rsc.ts";
import { parseTreadmill } from "./treadmill.ts";

export type RunMeasure = "speed" | "incline" | "stepCadence";
export type RunKind = "treadmill" | "rsc";

// [low, high, decimals]: speed km/h, incline %, steps a minute.
const RANGES: Readonly<Record<RunMeasure, readonly [number, number, number]>> = {
  speed: [0, 40, 1],
  incline: [-15, 40, 1],
  stepCadence: [0, 250, 0],
};

/** The reading rounded to its places, or null when it is not one (outside its range, not finite). */
export function runReading(m: RunMeasure, v: number): number | null {
  if (!Number.isFinite(v)) return null;
  const [lo, hi, places] = RANGES[m];
  const scale = 10 ** places;
  const r = Math.round(v * scale) / scale;
  return r >= lo && r <= hi ? r : null;
}

export function decodeRunning(kind: RunKind, dv: DataView): readonly { measure: RunMeasure; value: number }[] {
  const raw: [RunMeasure, number | undefined][] = [];
  if (kind === "treadmill") {
    const t = parseTreadmill(dv);
    if (t) raw.push(["speed", t.kmh], ["incline", t.inclinePct]);
  } else {
    const r = parseRsc(dv);
    if (r) raw.push(["speed", r.kmh], ["stepCadence", r.stepsPerMin]);
  }
  const out: { measure: RunMeasure; value: number }[] = [];
  for (const [measure, v] of raw) {
    const value = v === undefined ? null : runReading(measure, v);
    if (value !== null) out.push({ measure, value });
  }
  return out;
}
