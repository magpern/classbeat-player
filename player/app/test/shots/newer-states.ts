// The "class needs a newer player" states of the class list (docs/design/class-list.md, "Class
// needs a newer player"; mock-up mockups/class-list-needs-newer.html): a row with a music source this
// player does not know, and a row of a format major it does not know (title and length unread, so
// "Untitled class" and 0:00), each with its row selected and not selected. The screenshot run
// renders each at every size; all classes are made up.
import type { ListRow } from "../../src/core/list/rows.ts";
import { row, SYNCED, view } from "../unit/list-fixtures.ts";
import type { State } from "./states.ts";

const CLASSES: readonly [title: string, songs: number, minutes: number, updated: string][] = [
  ["Beginners: find your legs", 9, 40, "2026-08-02"],
  ["Friday party ride", 15, 60, "2026-10-17"],
  ["FTP test, 20 minutes", 12, 55, "2026-09-30"],
  ["Hill repeats: six climbs of three minutes", 13, 50, "2026-11-02"],
  ["Monday morning endurance", 12, 45, "2026-11-09"],
  ["Recovery spin", 7, 30, "2026-09-18"],
  ["Thursday threshold", 11, 42, "2026-11-11"],
];

const rowsWith = (count: number, over: Partial<ListRow>): ListRow[] =>
  CLASSES.slice(0, count).map(([title, songs, minutes, updated], i) =>
    row(title, i + 1, { songs, lengthMs: minutes * 60_000, updated: `${updated}T12:00:00+00:00`, ...(i === count - 1 ? over : {}) }),
  );

// An unknown source keeps its title and length; an unknown major shows what #948 builds for them.
const SOURCE = rowsWith(7, { source: "unknown" });
const MAJOR: ListRow[] = [
  ...rowsWith(6, {}),
  row("Untitled class", 8, { source: "unknown", songs: 0, lengthMs: 0, updated: "2026-11-11T12:00:00+00:00" }),
];

const state = (name: string, rows: readonly ListRow[], select?: string): State => ({
  name: `needs-newer-${name}`,
  view: view({ rows: [...rows], sync: { ...SYNCED, classes: rows.length } }),
  ...(select !== undefined ? { select } : {}),
});

export const NEEDS_NEWER_STATES: readonly State[] = [
  state("source-selected", SOURCE, SOURCE[6].id),
  state("source", SOURCE),
  state("major-selected", MAJOR, MAJOR[6].id),
  state("major", MAJOR),
];
