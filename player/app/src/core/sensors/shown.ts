// What the screen shows of a reading (docs/design/sensors.md, "What a reading is"). Pure.
// A shown number steps at most once a second, as a step. A reading that lapsed shows as missing at
// once: a number that is no longer true is never kept on screen to pace the steps.
import type { Measure } from "./types.ts";

export const STEP_MS = 1000;
export type Values = Readonly<Record<Measure, number | null>>;
export interface Shown {
  readonly values: Values;
  /** When each measure's number last changed. */
  readonly changedAt: Readonly<Record<Measure, number>>;
}

export const NONE: Shown = { values: { heartRate: null, power: null, cadence: null }, changedAt: { heartRate: -Infinity, power: -Infinity, cadence: -Infinity } };

export function step(prev: Shown, fresh: Values, now: number): Shown {
  const values = { ...prev.values };
  const changedAt = { ...prev.changedAt };
  for (const m of Object.keys(values) as Measure[]) {
    const next = fresh[m];
    if (next === prev.values[m]) continue;
    if (next !== null && prev.values[m] !== null && now - prev.changedAt[m] < STEP_MS) continue;
    values[m] = next;
    changedAt[m] = now;
  }
  return { values, changedAt };
}
