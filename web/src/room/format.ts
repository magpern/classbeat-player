// Text the room screen shows for numbers and ranges (docs/design/room-2d.md, "Fitting text"). Pure.
import type { Class } from "./input.ts";

type Interval = Class["intervals"][number];
type ZoneDef = Class["zone_scale"][number];

const MIN = 60_000;

/** M:SS below ten minutes, MM:SS to an hour, H:MM:SS from one hour; whole seconds, rounded down. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s}`;
  return `${m}:${s}`;
}

/** Class time in the rail: `MM:SS`, and `H:MM:SS` from one hour. */
export function classTimeText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total >= 3600) return clockText(ms);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The countdown: `M:SS` below 10 minutes, `MM:SS` from 10:00 to 99:59; an interval of 100 minutes
 * or more shows `99+` until 99:59 remain.
 */
export function countdownText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total >= 100 * 60) return "99+";
  // Minutes, never hours: an interval of an hour shows 58:58, not 0:58:58.
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The countdown's size is chosen for the interval's format and stays fixed for the interval. */
export function countdownIsWide(intervalLengthMs: number): boolean {
  return intervalLengthMs >= 10 * MIN;
}

/** Whole hours and minutes of a class length, for the title block: `42:00`, `2:12:00`. */
export function lengthText(ms: number): string {
  return clockText(ms);
}

export function rangeText(from: number, to: number): string {
  return `${from}–${to}`;
}

/** The targets of a zone, in the order of the spec: %FTP, RPE, %HRmax; the ones the scale has. */
export function targetTexts(def: ZoneDef | undefined): string[] {
  if (!def) return [];
  const out: string[] = [];
  if (def.ftp_pct) out.push(`${rangeText(def.ftp_pct[0], def.ftp_pct[1])}% FTP`);
  if (def.rpe) out.push(`RPE ${rangeText(def.rpe[0], def.rpe[1])}`);
  if (def.hrmax_pct) out.push(`${rangeText(def.hrmax_pct[0], def.hrmax_pct[1])}% HRmax`);
  return out;
}

export interface CadenceText {
  readonly value: string;
  readonly unit: string | null;
}

export function cadenceText(iv: Interval): CadenceText | null {
  const c = iv.cadence;
  if (c === undefined) return null;
  if (c === "beat") return { value: "On the beat", unit: null };
  return { value: rangeText(c.from, c.to), unit: "rpm" };
}

export function positionText(iv: Interval): string | null {
  if (iv.position === "seated") return "Seated";
  if (iv.position === "standing") return "Standing";
  return null;
}

/** The zone's own entry in the class's scale; the name and targets are the class's, not ours. */
export function zoneDef(doc: Class, zone: number): ZoneDef | undefined {
  return doc.zone_scale.find((z) => z.zone === zone);
}
