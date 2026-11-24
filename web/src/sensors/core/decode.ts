// decode_calc: one notification of an allowlisted characteristic into readings (ADR 0012 section 3).
// Pure: the bytes, the previous crank event and the time in; the readings and the new crank event out.
// Cadence from crank data needs two events, so the caller keeps the last one per device.
import { crankCadence, type Crank } from "./crank.ts";
import { parseCsc } from "./csc.ts";
import { parseCyclingPower } from "./cycling-power.ts";
import type { Stamped } from "./freshness.ts";
import { parseHeartRate } from "./heart-rate.ts";
import { parseIndoorBike } from "./indoor-bike.ts";
import { reading, type Measure } from "./readings.ts";

export type Kind = "hr" | "csc" | "power" | "bike";

export interface Decoded {
  readonly readings: readonly { readonly measure: Measure; readonly value: number }[];
  /** The crank event to keep for the next notification, when this one had one. */
  readonly crank?: Stamped<Crank>;
}

const NONE: Decoded = { readings: [] };

function push(out: { measure: Measure; value: number }[], measure: Measure, v: number | null | undefined): void {
  if (v === null || v === undefined) return;
  const r = reading(measure, v);
  if (r !== null) out.push({ measure, value: r });
}

export function decode(kind: Kind, dv: DataView, prev: Stamped<Crank> | null, at: number): Decoded {
  const out: { measure: Measure; value: number }[] = [];
  if (kind === "hr") {
    push(out, "hr", parseHeartRate(dv)?.bpm);
    return { readings: out };
  }
  if (kind === "bike") {
    const b = parseIndoorBike(dv);
    if (!b) return NONE;
    push(out, "power", b.watts);
    push(out, "cadence", b.cadence);
    return { readings: out };
  }
  const p: { watts?: number; crank?: Crank } | null = kind === "power" ? parseCyclingPower(dv) : parseCsc(dv);
  if (!p) return NONE;
  push(out, "power", p.watts);
  if (!p.crank) return { readings: out };
  // An unchanged event time means no new crank event: keep the old one, so its age stays true.
  if (prev && prev.value.time === p.crank.time && prev.value.revs === p.crank.revs) return { readings: out, crank: prev };
  const crank = { value: p.crank, at };
  if (prev) push(out, "cadence", crankCadence(prev, crank));
  return { readings: out, crank };
}
