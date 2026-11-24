// What a measure is set against, from the open class's current interval (docs/design/sensors.md,
// "What a reading is"). Pure. Read only: nothing here changes a target, a time or a colour.
import type { Interval, ZoneDef } from "../../../../../schema/generated/ts/class.d.ts";
import type { Measure } from "./types.ts";

export interface Numbers {
  /** The instructor's own FTP in watts (50 to 600) and maximum heart rate in bpm (80 to 230), or null. */
  readonly ftp: number | null;
  readonly hrmax: number | null;
}
export const NO_NUMBERS: Numbers = { ftp: null, hrmax: null };

const whole = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
/** Numbers typed into the two fields; anything outside the range is not a number. */
export function numbersFrom(ftp: unknown, hrmax: unknown): Numbers {
  return { ftp: whole(ftp, 50, 600), hrmax: whole(hrmax, 80, 230) };
}

export interface Plan {
  /** The plan in the reading's own unit, when there is one to gauge against. */
  readonly range: readonly [number, number] | null;
  /** The plan's text without "Plan": "157–170 bpm", "70–80 % of max", "on the beat", or null. */
  readonly text: string | null;
  /** The plan is a percentage because the person's number is missing; the panel says where to type it. */
  readonly needsNumber: boolean;
  /** The zone the band stands for, or null. */
  readonly zone: number | null;
}

const NONE: Plan = { range: null, text: null, needsNumber: false, zone: null };

function share(pct: readonly [number, number] | undefined, base: number | null, unit: string, pctText: string): Plan | null {
  if (!pct) return null;
  if (base === null) return { range: null, text: `${pct[0]}–${pct[1]} ${pctText}`, needsNumber: true, zone: null };
  const r: [number, number] = [Math.round((pct[0] * base) / 100), Math.round((pct[1] * base) / 100)];
  return { range: r, text: `${r[0]}–${r[1]} ${unit}`, needsNumber: false, zone: null };
}

export function planFor(measure: Measure, iv: Interval | null, zone: ZoneDef | null, n: Numbers): Plan {
  if (!iv) return NONE;
  let p: Plan | null = null;
  if (measure === "heartRate") p = share(zone?.hrmax_pct, n.hrmax, "bpm", "% of max");
  else if (measure === "power") p = share(zone?.ftp_pct, n.ftp, "W", "% of FTP");
  else if (iv.cadence === "beat") p = { range: null, text: "on the beat", needsNumber: false, zone: null };
  else if (iv.cadence) p = { range: [iv.cadence.from, iv.cadence.to], text: `${iv.cadence.from}–${iv.cadence.to} rpm`, needsNumber: false, zone: null };
  return p ? { ...p, zone: iv.zone } : NONE;
}
