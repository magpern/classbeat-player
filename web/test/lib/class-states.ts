// Every state of the website's Classes pages (docs/design/site.md, "Classes"): the list, loading,
// empty, class details, the delete confirmation and its failures, deleted and not found, with
// the address, the recorded answers and the steps a person takes. Joined to the website's own
// table (site-states.ts), so each is shot at 390 and 1280 and at 200 % text and held to S1 to S12.
import type { Page } from "playwright-core";
import type { Reply, Script } from "./site-fake.ts";
import type { State } from "./site-states.ts";

export const CLASS_ID = "3f6d2c1a-8b4e-4f7a-9c2d-1e5a7b9c0d3f";
const MIN = 60_000;

/** Twelve classes, as the spec's list mock-up shows them: the route answers latest change first; the page sorts. */
export const LIST: readonly (readonly [string, number, string])[] = [
  ["Thursday threshold", 42 * MIN, "2026-11-13T09:00:00Z"],
  ["Tempo and tension", 45 * MIN, "2026-10-21T09:00:00Z"],
  ["Sweet spot builder", 40 * MIN, "2026-10-28T09:00:00Z"],
  ["Short and sharp, 30 minutes", 30 * MIN, "2026-08-21T09:00:00Z"],
  ["Recovery spin", 30 * MIN, "2026-09-18T09:00:00Z"],
  ["Pyramid intervals", 45 * MIN, "2026-09-04T09:00:00Z"],
  ["Monday morning endurance", 45 * MIN, "2026-11-09T09:00:00Z"],
  ["Late summer long ride", 75 * MIN, "2025-12-14T09:00:00Z"],
  ["Hill repeats: six climbs of three minutes", 50 * MIN, "2026-11-02T09:00:00Z"],
  ["FTP test, 20 minutes", 55 * MIN, "2026-09-30T09:00:00Z"],
  ["Friday party ride", 60 * MIN, "2026-10-17T09:00:00Z"],
  ["Beginners: find your legs", 40 * MIN, "2026-08-02T09:00:00Z"],
];

export const idOf = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

/** One entry of `GET classes`, as the route gives it. */
export const entry = (id: string, title: string, lengthMs: number, changed: string, removed = false) => ({
  class_id: id, source: "classbeat", source_class_id: `src-${id.slice(-4)}`, publication_number: 1, removed, title, length_ms: lengthMs, changed_at: changed,
});

export const library = (n: number = LIST.length) => LIST.slice(0, n).map(([title, ms, at], i) => entry(idOf(i + 1), title, ms, at));

/** `GET classes`: a page of the library. */
export const listReply = (entries: readonly ReturnType<typeof entry>[], cursor: string | null = null): Reply => ({ status: 200, body: { classes: entries, cursor, more: cursor !== null } });

const ZONE_SCALE = [
  { zone: 1, name: "Recovery" },
  { zone: 2, name: "Endurance" },
  { zone: 3, name: "Tempo" },
  { zone: 4, name: "Threshold" },
  { zone: 5, name: "Hard" },
];
const CUES: readonly (readonly [number, number, number, Record<string, unknown>, string])[] = [
  [0, 5, 1, { cadence: { from: 80, to: 90 }, position: "seated" }, "Easy spin, loosen the legs"],
  [5, 10, 2, { cadence: { from: 85, to: 95 }, position: "seated" }, "Settle into a steady rhythm"],
  [15, 5, 3, { cadence: { from: 85, to: 95 }, position: "seated" }, "Lift it, still smooth"],
  [20, 2, 4, { cadence: { from: 70, to: 80 }, position: "standing" }, "Stand and push"],
  [22, 3, 2, { cadence: "beat", position: "seated" }, "Ride with the music"],
  [25, 4, 4, { cadence: { from: 75, to: 85 }, position: "seated" }, "Hold it, breathe"],
  [29, 1, 5, { cadence: { from: 90, to: 100 }, position: "seated" }, "All you have"],
  [30, 15, 2, { cadence: { from: 85, to: 95 }, position: "seated" }, "Easy now, breathe out"],
];
const SONGS: readonly (readonly [string, string, number])[] = [
  ["Midnight City", "M83", 243_000], ["Feel It Still", "Portugal. The Man", 163_000], ["Dreams", "Fleetwood Mac", 257_000],
  ["Blinding Lights", "The Weeknd", 202_000], ["Starboy", "The Weeknd", 230_000], ["Levitating", "Dua Lipa", 203_000],
];

/** A class document of the class format, as `GET classes/{id}` holds it. */
export const document = (title = "Monday morning endurance") => ({
  format_version: "1.0",
  class: { title, sport: "cycling", length_ms: 45 * MIN },
  music: { source: "spotify", design_crossfade_ms: 9000, song_timing: "estimated" },
  zone_scale: ZONE_SCALE,
  totals: { length_ms: 45 * MIN, time_in_zone_ms: { 1: 5 * MIN, 2: 28 * MIN, 3: 5 * MIN, 4: 6 * MIN, 5: MIN } },
  intervals: CUES.map(([at, len, zone, targets, cue]) => ({ start_ms: at * MIN, length_ms: len * MIN, zone, cue, ...targets })),
  songs: SONGS.map(([title, artist, length], i) => ({ title, artist, length_ms: length, start_ms: i * 240_000, end_ms: i * 240_000 + length })),
});

/** `GET classes/{id}`: one class with its document. */
export const classReply = (doc: unknown = document(), id = CLASS_ID): Reply => ({
  status: 200,
  body: { class_id: id, source: "classbeat", source_class_id: "c-1", publication_number: 1, content_hash: "h".repeat(8), changed_at: "2026-11-09T12:00:00Z", document: doc },
});

/** A running class with no music: the incline instead of cadence and position. */
export const runningDocument = () => ({
  format_version: "1.0",
  class: { title: "Tempo run", sport: "running", length_ms: 20 * MIN },
  music: { source: "none", design_crossfade_ms: 0, song_timing: "missing" },
  zone_scale: ZONE_SCALE,
  totals: { length_ms: 20 * MIN, time_in_zone_ms: { 2: 15 * MIN, 4: 5 * MIN } },
  intervals: [
    { start_ms: 0, length_ms: 15 * MIN, zone: 2, incline: "flat", cue: "Easy and even" },
    { start_ms: 15 * MIN, length_ms: 5 * MIN, zone: 4, incline: "raised", cue: "Hold the effort" },
  ],
  songs: [],
});

const NOT_FOUND: Reply = { status: 404, body: { error: "not_found" } };
const detail = `/classes/${CLASS_ID}`;
const read = (reply: Reply = classReply()): Script => ({ [`GET classes/${CLASS_ID}`]: reply });
const deleting = (reply: Reply): Script => ({ ...read(), [`DELETE classes/${CLASS_ID}`]: reply });
const press = (text: string) => async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: text, exact: true }).click();
};
const askDelete = press("Delete class");
/** Delete class twice: the row's button opens the panel, the panel's sends the request. */
const confirmDelete = async (page: Page): Promise<void> => {
  await askDelete(page);
  await press("Delete class")(page);
};
const HELD: Reply = { status: 200, hold: true };

export const CLASS_STATES: readonly State[] = [
  { name: "classes", path: "/classes", script: { "GET classes": listReply(library()) }, ready: ".rows .row", main: true },
  { name: "classes-few", path: "/classes", script: { "GET classes": listReply(library(3)) }, ready: ".rows .row" },
  { name: "classes-loading", path: "/classes", script: { "GET classes": HELD }, ready: ".status" },
  { name: "classes-empty", path: "/classes", script: { "GET classes": listReply([]) }, ready: ".btns a" },
  {
    name: "classes-no-match",
    path: "/classes",
    script: { "GET classes": listReply(library()) },
    steps: async (page) => {
      await page.fill("input[name=filter]", "zzz");
    },
    ready: "p.small[role=status] span",
  },
  {
    name: "classes-deleted",
    path: detail,
    script: { ...deleting({ status: 204 }), "GET classes": listReply(library().slice(1)) },
    steps: confirmDelete,
    ready: ".note",
  },
  { name: "class-details", path: detail, script: read(), ready: ".zrow", main: true },
  { name: "class-details-running", path: detail, script: read(classReply(runningDocument())), ready: ".zrow" },
  { name: "class-delete", path: detail, script: read(), steps: askDelete, ready: ".panel" },
  { name: "class-delete-working", path: detail, script: deleting(HELD), steps: confirmDelete, ready: ".panel .status" },
  { name: "class-delete-limited", path: detail, script: deleting({ status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "300" } }), steps: confirmDelete, ready: ".panel .plate" },
  { name: "class-delete-offline", path: detail, script: deleting({ status: 0, fail: true }), steps: confirmDelete, ready: ".panel .plate" },
  { name: "class-delete-server", path: detail, script: deleting({ status: 500, body: { error: "internal" } }), steps: confirmDelete, ready: ".panel .plate" },
  { name: "class-not-found", path: detail, script: read(NOT_FOUND), ready: ".btns a" },
];
