// The two screens that are not running: before the start (lights down on the first zone, the class
// laid out) and after the end (house lights up). Pure.
import { nameTier } from "./fit.ts";
import { lengthText, targetTexts, zoneDef, clockText } from "./format.ts";
import type { Class } from "./input.ts";
import type { GelModel, IntroModel, ZoneRow } from "./model.ts";

export function zoneRows(doc: Class): ZoneRow[] {
  const rows: ZoneRow[] = [];
  for (const def of [...doc.zone_scale].sort((a, b) => a.zone - b.zone)) {
    const ms = doc.totals.time_in_zone_ms[String(def.zone)] ?? 0;
    if (ms > 0) rows.push({ zone: def.zone, time: clockText(ms), name: def.name });
  }
  return rows;
}

/** One row per zone the class uses: the time in each, as planned. */
const ZONES_TITLE = "Time in each zone, as planned";

export function beforeStartIntro(doc: Class): IntroModel {
  const facts = [
    { label: "Length", value: lengthText(doc.class.length_ms) },
    { label: "Songs", value: String(doc.songs.length) },
    { label: "Intervals", value: String(doc.intervals.length) },
  ];
  if (doc.totals.planned_load !== undefined) facts.push({ label: "Class load", value: String(Math.round(doc.totals.planned_load)) });
  return { title: doc.class.title, facts, zonesTitle: ZONES_TITLE, zones: zoneRows(doc) };
}

export function finishedIntro(doc: Class): IntroModel {
  const facts = [
    { label: "Ridden", value: lengthText(doc.class.length_ms) },
    { label: "Songs", value: String(doc.songs.length) },
  ];
  if (doc.totals.planned_load !== undefined) facts.push({ label: "Class load, planned", value: String(Math.round(doc.totals.planned_load)) });
  return { title: doc.class.title, facts, zonesTitle: ZONES_TITLE, zones: zoneRows(doc) };
}

/** Lights down on the first zone: the stage is dark and the colour moves into the numeral. */
export function firstZoneGel(doc: Class): GelModel {
  const zone = doc.intervals[0].zone;
  const def = zoneDef(doc, zone);
  const name = def?.name ?? "";
  return { look: "down", zone, label: "First zone", numeral: String(zone), name, nameTier: nameTier(name), targets: targetTexts(def) };
}

/** The house lights up: a white gel, no zone, "Class Complete" and the length. */
export function completeGel(doc: Class): GelModel {
  return { look: "blank", zone: null, label: "Class", numeral: null, name: "Complete", nameTier: "one", targets: [lengthText(doc.class.length_ms)] };
}
