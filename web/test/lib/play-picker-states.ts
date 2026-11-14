// The picker and the states around it (docs/design/play.md, "The picker and the states around it"):
// pages of the website, checked with the website's own checks (site.md, S1 to S12), so each is a
// state of site-states.ts: its address, the recorded answers and what a person has done.
import { CLASS_ID, entry, listAnswer, NOT_FOUND, NOT_SIGNED_IN } from "./play-fake.ts";
import type { State } from "./site-states.ts";

/** Twelve classes, as the spec's picker mock-up lists them (the route answers latest change first; the page sorts). */
export const CLASSES = [
  ["Thursday threshold", 2_520_000, "2026-11-13T09:00:00Z"],
  ["Tempo and tension", 2_700_000, "2026-10-21T09:00:00Z"],
  ["Sweet spot builder", 2_400_000, "2026-10-28T09:00:00Z"],
  ["Short and sharp, 30 minutes", 1_800_000, "2026-08-21T09:00:00Z"],
  ["Recovery spin", 1_800_000, "2026-09-18T09:00:00Z"],
  ["Pyramid intervals", 2_700_000, "2026-09-04T09:00:00Z"],
  ["Monday morning endurance", 2_700_000, "2026-11-09T09:00:00Z"],
  ["Late summer long ride", 4_500_000, "2025-12-14T09:00:00Z"],
  ["Hill repeats: six climbs of three minutes", 3_000_000, "2026-11-02T09:00:00Z"],
  ["FTP test, 20 minutes", 3_300_000, "2026-09-30T09:00:00Z"],
  ["Friday party ride", 3_600_000, "2026-10-17T09:00:00Z"],
  ["Beginners: find your legs", 2_400_000, "2026-08-02T09:00:00Z"],
] as const;

export const idOf = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
export const library = (n: number = CLASSES.length) => CLASSES.slice(0, n).map(([title, ms, at], i) => entry(idOf(i + 1), title, ms, at));

const HELD = { status: 200, hold: true } as const;
/** Every state of the picker, by name; the path is the page's, with its fragment. */
const STATES: readonly State[] = [
  { name: "picker", path: "/play", script: { "GET classes": listAnswer(library()) }, ready: ".rows .row", main: true },
  { name: "picker-few", path: "/play", script: { "GET classes": listAnswer(library(3)) }, ready: ".rows .row" },
  { name: "picker-loading", path: "/play", script: { "GET classes": HELD }, ready: ".status" },
  { name: "picker-empty", path: "/play", script: { "GET classes": listAnswer([]) }, ready: ".btns a" },
  { name: "opening", path: `/play#${CLASS_ID}`, script: { [`GET classes/${CLASS_ID}`]: HELD }, ready: ".status" },
  { name: "signed-out", path: "/play", script: { "GET classes": NOT_SIGNED_IN }, ready: ".btns a" },
  // A session that was there: the first page answered, the next one did not.
  { name: "session-ended", path: "/play", script: { "GET classes": [listAnswer(library(2), "next"), NOT_SIGNED_IN] }, ready: ".note" },
  { name: "offline", path: "/play", script: { "GET classes": { status: 0, fail: true } }, ready: ".plate" },
  { name: "not-found", path: `/play#${CLASS_ID}`, script: { [`GET classes/${CLASS_ID}`]: NOT_FOUND }, ready: ".btns button" },
  { name: "too-many", path: "/play", script: { "GET classes": { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "300" } } }, ready: ".plate" },
  { name: "server", path: "/play", script: { "GET classes": { status: 500, body: { error: "internal" } } }, ready: ".plate" },
];
/** Each with the page's date fixed at 13 Nov 2026 (the day of the newest class), so the date column reads the same on every day the shots are taken. */
export const PICKER_STATES: readonly State[] = STATES.map((state) => ({ ...state, clock: "day" as const }));
