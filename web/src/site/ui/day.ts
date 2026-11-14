// The page's own clock and time zone, read at the edge: the calendar day of an instant the
// backend sent, and today. The pure models (core/devices-model.ts) take these days and word them.
import type { Day } from "../core/devices-model.ts";

/** The calendar day of an instant in the page's own time zone, or null for a date it cannot read. */
export function dayOf(iso: string): Day | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export const today = (): Day => {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
};
