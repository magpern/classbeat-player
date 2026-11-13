// The 19 states of the class list (docs/design/class-list.md, "States"), as the views the shell would
// send, with the classes of the reference mock-ups. The screenshot run renders each at every size.
import type { ListRow } from "../../src/core/list/rows.ts";
import type { ListView } from "../../src/core/list/view.ts";
import { NOTICE_TEXT } from "../../src/core/pairing/view.ts";
import { PAIRED, row, SYNCED, view } from "../unit/list-fixtures.ts";

/** The window sizes of the spec: 1920x1080, 1280x800, and 1000x720 (the default and the smallest). */
export const SIZES: readonly (readonly [number, number])[] = [[1920, 1080], [1280, 800], [1000, 720]];

type Mock = [title: string, songs: number, minutes: number, updated: string, over?: Partial<ListRow>];
const MOCKS: Mock[] = [
  ["Beginners: find your legs", 9, 40, "2026-08-02"],
  ["Friday party ride", 15, 60, "2026-10-17"],
  ["FTP test, 20 minutes", 12, 55, "2026-09-30"],
  ["Hill repeats: six climbs of three minutes", 13, 50, "2026-11-02"],
  ["Late summer long ride", 18, 75, "2025-12-14"],
  ["Monday morning endurance", 12, 45, "2026-11-09"],
  ["Pyramid intervals", 11, 45, "2026-09-04"],
  ["Recovery spin", 7, 30, "2026-09-18"],
  ["Short and sharp, 30 minutes", 8, 30, "2026-08-21"],
  ["Sweet spot builder", 10, 40, "2026-10-28"],
  ["Tempo and tension", 0, 45, "2026-10-21", { source: "none" }],
  ["Thursday threshold", 11, 42, "2026-11-11"],
];

const make = (m: Mock, n: number, over: Partial<ListRow> = {}): ListRow =>
  row(m[0], n, { songs: m[1], lengthMs: m[2] * 60_000, updated: `${m[3]}T12:00:00+00:00`, ...m[4], ...over });

const TWELVE = MOCKS.map((m, i) => make(m, i + 1));

const WORDS = ["Climb", "Sprint", "Endurance", "Tempo", "Threshold", "Cadence", "Recovery", "Pyramid", "Rolling hills", "Steady", "Over-unders", "Spin-up", "Long road"];
const FORTY_TWO: ListRow[] = Array.from({ length: 42 }, (_, i) => make([`${WORDS[i % WORDS.length]} ${Math.floor(i / WORDS.length) + 1}`, 6 + (i % 12), 30 + (i % 4) * 15, `2026-0${1 + (i % 9)}-1${i % 9}`], i + 1));

const WIDE = "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW".slice(0, 80);
const LONG_TITLES: ListRow[] = [
  make(["Long climbing session with many short and punchy intervals followed by a slow and steady steady-state finish ride", 14, 60, "2026-11-05"], 1),
  make([WIDE, 12, 45, "2026-11-03"], 2),
  make(["A" + "b".repeat(79), 10, 45, "2026-10-11"], 3),
  make(["Mixed capitals: THE FINAL SPRINT OF THE SEASON WITH MANY LONG REPEATS AND SHORT RESTS", 8, 45, "2026-09-12"], 4),
  make(["Normal title", 9, 40, "2026-08-01"], 5),
  make(["Another normal one", 9, 40, "2026-08-02"], 6),
];

const playing = (r: ListRow[], title: string, over: Partial<ListRow>): ListRow[] => r.map((x) => (x.title === title ? { ...x, playing: true, ...over } : x));
const synced = (rows: ListRow[], over: Partial<ListView["sync"]> = {}): ListView["sync"] => ({ ...SYNCED, classes: rows.length, ...over });
const unpaired = (message: string | null): ListView["pairing"] => ({ state: "unpaired", message });

export interface State {
  readonly name: string;
  readonly view: ListView;
  /** Typed into the filter before the screenshot. */
  readonly type?: string;
}

const thursday = TWELVE.find((r) => r.title === "Thursday threshold")!;

export const STATES: readonly State[] = [
  { name: "synced", view: view({ rows: TWELVE, sync: synced(TWELVE) }) },
  { name: "syncing", view: view({ rows: TWELVE, sync: synced(TWELVE, { status: "syncing" }) }) },
  { name: "first-sync", view: view({ sync: synced([], { status: "syncing" }) }) },
  { name: "offline", view: view({ rows: TWELVE, sync: synced(TWELVE, { status: "offline" }) }) },
  { name: "waiting", view: view({ rows: TWELVE, sync: synced(TWELVE, { status: "waiting" }) }) },
  { name: "expired", view: view({ rows: TWELVE, sync: synced(TWELVE, { status: "expired" }), pairing: { ...PAIRED, pairAgain: true } }) },
  { name: "wiping", view: view({ sync: synced([], { status: "unpaired", wiping: true }), pairing: unpaired(null) }) },
  { name: "revoked", view: view({ sync: synced([], { status: "unpaired" }), pairing: unpaired(NOTICE_TEXT.revoked_on_site) }) },
  { name: "not-paired", view: view({ sync: synced([], { status: "unpaired" }), pairing: unpaired(null) }) },
  { name: "pairing-start", view: view({ sync: synced([], { status: "unpaired" }), pairing: { state: "starting" } }) },
  { name: "pairing", view: view({ sync: synced([], { status: "unpaired" }), pairing: { state: "waiting", userCode: "WDJB-MJHT", page: "https://player.example/pair", secondsLeft: 581 } }) },
  { name: "empty", view: view({ sync: synced([]) }) },
  { name: "long-list", view: view({ rows: FORTY_TWO, sync: synced(FORTY_TWO) }) },
  { name: "no-match", view: view({ rows: FORTY_TWO, sync: synced(FORTY_TWO) }), type: "zzz" },
  { name: "long-titles", view: view({ rows: LONG_TITLES, sync: synced(LONG_TITLES) }) },
  { name: "pinned-newer", view: view({ rows: playing(TWELVE, thursday.title, { newer: true }), sync: synced(TWELVE, { pinned: { id: thursday.id, after: "newer" } }) }) },
  { name: "file-error", view: view({ rows: TWELVE, sync: synced(TWELVE), fileError: { message: "This class file is not valid.", fileName: "thursday-threshold.json", details: ["unknown_zone at /intervals/3/zone", "missing_field at /songs/4/title"] } }) },
  { name: "unavailable", view: view({ sync: synced([], { status: "unavailable", unavailable: "passing" }) }) },
  { name: "not-updated", view: view({ rows: TWELVE.map((r) => (r.title.startsWith("Hill") ? { ...r, notUpdated: true } : r)), sync: synced(TWELVE, { notUpdated: [TWELVE[3].id] }) }) },
];
