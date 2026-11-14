// Whether an answer's document is a class this page can run (docs/design/play.md, "The class").
// Pure. The backend validates a class when it is stored; this is the page's own guard before it
// draws anything from it, so a document of another shape shows the error page, never a half screen.
import type { Class } from "../room/input.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The parts of a class the room screen and the clock read: its length, zones, intervals and songs. */
export function isPlayableClass(doc: unknown): doc is Class {
  if (!isRecord(doc) || !isRecord(doc.class) || !isRecord(doc.music) || !isRecord(doc.totals)) return false;
  if (typeof doc.class.title !== "string" || !isNum(doc.class.length_ms) || doc.class.length_ms <= 0) return false;
  if (!Array.isArray(doc.zone_scale) || !Array.isArray(doc.songs) || !Array.isArray(doc.intervals) || doc.intervals.length === 0) return false;
  if (!isRecord(doc.totals.time_in_zone_ms)) return false;
  let next = 0;
  for (const iv of doc.intervals) {
    if (!isRecord(iv) || !isNum(iv.start_ms) || !isNum(iv.length_ms) || !isNum(iv.zone) || typeof iv.cue !== "string") return false;
    if (iv.start_ms !== next || iv.length_ms <= 0) return false;
    next = iv.start_ms + iv.length_ms;
  }
  if (next !== doc.class.length_ms) return false;
  if (!doc.zone_scale.every((z) => isRecord(z) && isNum(z.zone) && typeof z.name === "string")) return false;
  return doc.songs.every((s) => isRecord(s) && isNum(s.start_ms) && isNum(s.end_ms) && typeof s.title === "string");
}
