// The instructor's music files states of the class list (docs/design/music-files.md, "States"), as
// the views the shell would send, with the made-up classes of the reference mock-ups
// (docs/design/mockups/music-files-pages.js). The screenshot run renders each at every size; the
// names are the mock-ups' own (class-list-music-files-<name>). All titles, artists and file names are
// made up; there is no path and no folder anywhere.
import type { FilesView, MissingSong } from "../../src/core/music-files/files-view.ts";
import type { ListRow } from "../../src/core/list/rows.ts";
import { SYNCED, row, view } from "../unit/list-fixtures.ts";
import type { State } from "./states.ts";

const CLASSES: readonly [title: string, songs: number, minutes: number, updated: string, local?: true][] = [
  ["Beginners: find your legs", 9, 40, "2026-08-02"],
  ["Friday party ride", 15, 60, "2026-10-17", true],
  ["FTP test, 20 minutes", 12, 55, "2026-09-30"],
  ["Hill repeats: six climbs of three minutes", 13, 50, "2026-11-02"],
  ["Late summer long ride", 18, 75, "2025-12-14"],
  ["Monday morning endurance", 12, 45, "2026-11-09"],
  ["Pyramid intervals", 11, 45, "2026-09-04"],
  ["Recovery spin", 7, 30, "2026-09-18", true],
  ["Short and sharp, 30 minutes", 8, 30, "2026-08-21"],
  ["Sweet spot builder", 10, 40, "2026-10-28"],
  ["Tempo and tension", 0, 45, "2026-10-21"],
  ["Thursday threshold", 11, 42, "2026-11-11", true],
];

const rowsOf = (titles: Readonly<Record<string, string>> = {}): ListRow[] =>
  CLASSES.map(([title, songs, minutes, updated, local], i) =>
    row(titles[title] ?? title, i + 1, { songs, lengthMs: minutes * 60_000, updated: `${updated}T12:00:00+00:00`, source: local === true ? "local" : songs === 0 ? "none" : "spotify" }),
  );

const NEON: MissingSong = { title: "Neon Avenue", artist: "The Midnight Parade", fileName: "neon_avenue_final_v2.mp3" };
const PULSE: MissingSong = { title: "Pulse Theory", artist: "Aurora Lane", fileName: "07 Pulse Theory (radio edit).flac" };
const made = (n: number): MissingSong[] => Array.from({ length: n }, (_, i) => ({ title: `Song number ${i + 1}`, artist: `Artist ${i + 1}`, fileName: `track_${String(i + 1).padStart(2, "0")}.mp3` }));
const LONG = "The very long title of a song that someone typed with every word the format allows, ".repeat(3).slice(0, 200).trim();
const LONG_ARTIST = "A band with a very long name, featuring a guest, and a second guest, and then another one, ".repeat(3).slice(0, 200).trim();
const LONG_FILE = `${"a-long-file-name-without-spaces_" + "abcdefghij".repeat(30)}`.slice(0, 251) + ".mp3";

const WIDE = "WWWWWWWWWWWW MMMMMMMMMMMM WWWWWWWWWWWW MMMMMMMMMMMM WWWWWWWWWWWW MMMMMMM";

type Over = Partial<Omit<FilesView, "id" | "hash" | "total" | "missing">>;
const files = (title: string, total: number, missing: readonly MissingSong[], over: Over = {}): FilesView => {
  const r = rowsOf().find((x) => x.title === title)!;
  return { id: r.id, hash: r.hash, phase: "idle", held: over.phase !== undefined && over.phase !== "idle", total, missing, searched: false, failed: false, ...over };
};

const FRIDAY = files("Friday party ride", 15, []);
const RECOVERY = files("Recovery spin", 7, made(3));
const THURSDAY = "Thursday threshold";

/** The class list with the three local classes' states and the selected class's. */
const page = (thursday: FilesView, titles: Readonly<Record<string, string>> = {}): State["view"] => {
  const rows = rowsOf(titles);
  return view({ rows, sync: { ...SYNCED, classes: rows.length }, files: [FRIDAY, RECOVERY, thursday] });
};

const selectThursday = (): string => rowsOf().find((r) => r.title === THURSDAY)!.id;
const sel = (name: string, thursday: FilesView, extra: Partial<State> = {}): State => ({ name: `music-files-${name}`, view: page(thursday), select: selectThursday(), ...extra });

export const FILES_STATES: readonly State[] = [
  sel("found", files(THURSDAY, 11, [])),
  sel("missing", files(THURSDAY, 11, [NEON, PULSE])),
  sel("missing-one", files(THURSDAY, 11, [NEON])),
  sel("all-missing", files(THURSDAY, 11, made(11))),
  sel("choosing", files(THURSDAY, 11, [NEON, PULSE], { phase: "choosing" })),
  sel("finding", files(THURSDAY, 11, [NEON, PULSE], { phase: "finding" })),
  sel("still-missing", files(THURSDAY, 11, [NEON, PULSE], { searched: true })),
  sel("find-failed", files(THURSDAY, 11, [NEON, PULSE], { failed: true })),
  sel("worst-footer", files(THURSDAY, 11, made(11)), { view: page(files(THURSDAY, 11, made(11)), { [THURSDAY]: WIDE }) }),
  sel("list", files(THURSDAY, 11, [NEON, PULSE]), { click: ["files-show"] }),
  sel("list-worst", files(THURSDAY, 11, [{ title: LONG, artist: LONG_ARTIST, fileName: LONG_FILE }, PULSE, NEON, ...made(3)]), { click: ["files-show"] }),
];
