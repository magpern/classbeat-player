// effort_calc: the rider's effort for the zone (docs/design/rider.md, "The effort"; ADR 0007
// section 5), worked out on the phone from the zone's ranges in `rider_state` and the rider's own
// numbers, which never leave the phone. Pure: no DOM, no I/O.
//
// - Power: FTP × `ftpPct` in watts; without an FTP, the percentages ("88–94% FTP").
// - Heart rate: maximum heart rate × `hrmaxPct` in beats per minute; without it, "85–92% max".
//   A number taken from the planned zone's range, never a measured value (rule 7).
// - RPE: the range as it is.
// A range the zone does not have gives no row. Whole numbers, halves rounded up. A range with
// equal ends is written once. The values carry no advice (rule 8): they state the planned range.

export type Range = readonly [number, number];

export interface ZoneEffort {
  readonly ftpPct: Range | null;
  readonly hrmaxPct: Range | null;
  readonly rpe: Range | null;
}

/** The rider's own numbers, in the page's memory only; null where the rider gave none. */
export interface MyNumbers {
  readonly ftp: number | null;
  readonly hrmax: number | null;
}

export const NO_NUMBERS: MyNumbers = { ftp: null, hrmax: null };

export interface EffortRow {
  readonly label: "Power" | "Heart rate" | "RPE";
  readonly value: string;
  /** "W", "bpm", "FTP", "max", or "" for RPE. */
  readonly unit: string;
  /** The planned range in the unit, for a gauge; only on a row in watts or bpm. */
  readonly range?: Range;
}

export interface Effort {
  readonly rows: readonly EffortRow[];
  /** A percentage row stands in for a number the rider could give. */
  readonly hint: boolean;
}

export const HINT = "Add your FTP and max heart rate in My numbers to see watts and beats.";

/** `pct` percent of `base`, to a whole number, halves up. Integer arithmetic: no float error. */
export function percentOf(base: number, pct: number): number {
  return Math.floor((base * pct + 50) / 100);
}

/** "220–235", or "7" when both ends are equal. */
export function rangeWords(low: number, high: number): string {
  return low === high ? String(low) : `${low}–${high}`;
}

const scaledRange = (base: number, r: Range): Range => [percentOf(base, r[0]), percentOf(base, r[1])];
const scaledRow = (label: EffortRow["label"], range: Range, unit: string): EffortRow => ({ label, value: rangeWords(range[0], range[1]), unit, range });
const percent = (r: Range): string => `${rangeWords(r[0], r[1])}%`;

/** The effort rows for a zone and the rider's numbers, in the spec's order: power, heart rate, RPE. */
export function effortFor(zone: ZoneEffort, mine: MyNumbers): Effort {
  const rows: EffortRow[] = [];
  let hint = false;
  if (zone.ftpPct) {
    if (mine.ftp !== null) rows.push(scaledRow("Power", scaledRange(mine.ftp, zone.ftpPct), "W"));
    else {
      rows.push({ label: "Power", value: percent(zone.ftpPct), unit: "FTP" });
      hint = true;
    }
  }
  if (zone.hrmaxPct) {
    if (mine.hrmax !== null) rows.push(scaledRow("Heart rate", scaledRange(mine.hrmax, zone.hrmaxPct), "bpm"));
    else {
      rows.push({ label: "Heart rate", value: percent(zone.hrmaxPct), unit: "max" });
      hint = true;
    }
  }
  if (zone.rpe) rows.push({ label: "RPE", value: rangeWords(zone.rpe[0], zone.rpe[1]), unit: "" });
  return { rows, hint };
}
