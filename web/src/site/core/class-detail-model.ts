// What the class details page shows (docs/design/site.md, "Classes", class details). Pure: the
// answer of `GET classes/{id}` in, plain text out. The document is read as it came: a part that
// is not the shape the class format gives is left out, never guessed at. Read only: nothing here
// edits, reorders or ranks (rules 1, 10 and 13), and no zone has a colour (rule 7).
import { clockText } from "../../room/format.ts";
import { changedText } from "./classes-model.ts";

export interface ZoneTime {
  readonly zone: number;
  readonly name: string;
  readonly time: string;
}
export interface SongLine {
  readonly no: number;
  readonly title: string;
  readonly artist: string;
  readonly length: string;
}
export interface IntervalLine {
  readonly when: string;
  readonly zone: string;
  readonly targets: string;
  readonly cue: string;
}
export interface Detail {
  /** The class's title; null when the answer holds no document. */
  readonly title: string | null;
  readonly facts: string;
  readonly zones: readonly ZoneTime[];
  readonly songs: readonly SongLine[];
  readonly intervals: readonly IntervalLine[];
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

const SPORT: Readonly<Record<string, string>> = { cycling: "Cycling", running: "Running" };
const MUSIC: Readonly<Record<string, string>> = { spotify: "Spotify", swedebeat: "Swedebeat" };

const songsText = (n: number): string => `${n} ${n === 1 ? "song" : "songs"}`;

function factsOf(answer: Rec, doc: Rec, songs: number, now: Date): string {
  const info = isRecord(doc.class) ? doc.class : {};
  const music = isRecord(doc.music) ? doc.music : {};
  const parts: string[] = [];
  if (isNum(info.length_ms)) parts.push(clockText(info.length_ms));
  if (typeof info.sport === "string" && Object.hasOwn(SPORT, info.sport)) parts.push(SPORT[info.sport]);
  if (typeof music.source === "string") parts.push(Object.hasOwn(MUSIC, music.source) ? `${MUSIC[music.source]}, ${songsText(songs)}` : "No music");
  if (typeof answer.source === "string" && answer.source !== "") parts.push(`From ${answer.source}`);
  const changed = typeof answer.changed_at === "string" ? changedText(answer.changed_at, now) : "";
  // "changed Today" reads wrong: the relative words go in lower case, a date stays as it is.
  if (changed !== "") parts.push(`changed ${/^[A-Z]/.test(changed) ? changed.toLowerCase() : changed}`);
  return parts.join(" · ");
}

/** The zone names of the class's own scale, by zone number. */
function zoneNamesOf(doc: Rec): Map<number, string> {
  const names = new Map<number, string>();
  for (const z of list(doc.zone_scale)) if (isRecord(z) && isNum(z.zone) && typeof z.name === "string") names.set(z.zone, z.name);
  return names;
}

function zonesOf(doc: Rec, names: ReadonlyMap<number, string>): ZoneTime[] {
  const times = isRecord(doc.totals) && isRecord(doc.totals.time_in_zone_ms) ? doc.totals.time_in_zone_ms : {};
  const out: ZoneTime[] = [];
  for (const [key, ms] of Object.entries(times)) {
    if (/^[1-7]$/.test(key) && isNum(ms)) out.push({ zone: Number(key), name: names.get(Number(key)) ?? "", time: clockText(ms) });
  }
  return out.sort((a, b) => a.zone - b.zone);
}

function songsOf(doc: Rec): SongLine[] {
  const out: SongLine[] = [];
  for (const s of list(doc.songs)) {
    if (!isRecord(s) || typeof s.title !== "string") continue;
    out.push({ no: out.length + 1, title: s.title, artist: typeof s.artist === "string" ? s.artist : "", length: isNum(s.length_ms) ? clockText(s.length_ms) : "" });
  }
  return out;
}

/** The targets of an interval: the cadence and position of a cycling one, the incline of a running one, a test's name. */
export function targetsOf(iv: Rec): string {
  const parts: string[] = [];
  const cadence = iv.cadence;
  const position = iv.position === "seated" || iv.position === "standing" ? iv.position : null;
  if (cadence === "beat") parts.push("Cadence on the beat");
  else if (isRecord(cadence) && isNum(cadence.from) && isNum(cadence.to)) parts.push(`Cadence ${cadence.from} to ${cadence.to}`);
  if (position !== null) parts.push(position);
  if (iv.incline === "flat" || iv.incline === "raised") parts.push(`Incline ${iv.incline}`);
  if (isRecord(iv.test) && isNum(iv.test.minutes)) parts.push(`FTP test, ${iv.test.minutes} minutes`);
  return parts.join(", ");
}

function intervalsOf(doc: Rec, names: ReadonlyMap<number, string>): IntervalLine[] {
  const out: IntervalLine[] = [];
  for (const iv of list(doc.intervals)) {
    if (!isRecord(iv) || !isNum(iv.start_ms) || !isNum(iv.length_ms) || !isNum(iv.zone)) continue;
    const name = names.get(iv.zone);
    out.push({
      when: `${clockText(iv.start_ms)} for ${clockText(iv.length_ms)}`,
      zone: name ? `Zone ${iv.zone} ${name}` : `Zone ${iv.zone}`,
      targets: targetsOf(iv),
      cue: typeof iv.cue === "string" ? iv.cue : "",
    });
  }
  return out;
}

/** The page's content from an answer of `GET classes/{id}`; null when the answer is not an object at all. */
export function detailOf(body: unknown, now: Date): Detail | null {
  if (!isRecord(body)) return null;
  if (!isRecord(body.document)) return { title: null, facts: factsOf(body, {}, 0, now), zones: [], songs: [], intervals: [] };
  const doc = body.document;
  const info = isRecord(doc.class) ? doc.class : {};
  const songs = songsOf(doc);
  const names = zoneNamesOf(doc);
  return {
    title: typeof info.title === "string" && info.title !== "" ? info.title : null,
    facts: factsOf(body, doc, songs.length, now),
    zones: zonesOf(doc, names),
    songs,
    intervals: intervalsOf(doc, names),
  };
}
