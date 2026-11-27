// The instructor's music files state on the class list (docs/design/music-files.md, "States"): the
// words, markers and keys of each state, from the view alone, and how the class list's screen model
// uses them: the files line and keys in the footer of a local class, the marker on its row, the
// failure plate, the panel of the missing songs. Pure; no page.
import assert from "node:assert/strict";
import { test } from "node:test";
import { filesLineOf, filesListOf, filesPlateOf, rowFilesOf } from "../../src/core/list/files-screen.ts";
import { screenOf } from "../../src/core/list/screen.ts";
import type { FilesView, MissingSong } from "../../src/core/music-files/files-view.ts";
import { NOW, row, SYNCED, view } from "./list-fixtures.ts";

const song = (k: number): MissingSong => ({ title: `Song ${k}`, artist: `Artist ${k}`, fileName: `f${k}.mp3` });
const some = (n: number): MissingSong[] => Array.from({ length: n }, (_, i) => song(i + 1));
const fv = (total: number, missing: number, over: Partial<FilesView> = {}): FilesView => ({ id: "x", hash: "h", phase: "idle", held: over.phase !== undefined && over.phase !== "idle", total, missing: some(missing), searched: false, failed: false, ...over });
const keys = (l: ReturnType<typeof filesLineOf>): string[] => [l.show?.label, l.find?.label].filter((k): k is string => k !== undefined);

test("every state of the spec has its marker, words and keys", () => {
  const cases: [string, FilesView, string, string, string[], boolean][] = [
    ["found", fv(11, 0), "ok", "All 11 music files are found", [], false],
    ["found, one song", fv(1, 0), "ok", "The music file is found", [], false],
    ["missing", fv(11, 2), "away", "2 music files are missing", ["Show which files", "Find music files"], false],
    ["one missing", fv(11, 1), "away", "1 music file is missing", ["Show which files", "Find music files"], false],
    ["none found", fv(11, 11), "away", "All 11 music files are missing", ["Show which files", "Find music files"], false],
    ["choosing", fv(11, 2, { phase: "choosing" }), "work", "Choose the folder with your music", ["Find music files"], true],
    ["finding", fv(11, 2, { phase: "finding" }), "work", "Finding music files…", ["Find music files"], true],
    ["checking", fv(11, 2, { phase: "checking" }), "work", "Finding music files…", ["Show which files", "Find music files"], true],
    ["still missing", fv(11, 2, { searched: true }), "away", "2 music files are still missing", ["Show which files", "Find music files"], false],
    ["still missing, one", fv(11, 1, { searched: true }), "away", "1 music file is still missing", ["Show which files", "Find music files"], false],
  ];
  for (const [name, v, marker, text, offered, held] of cases) {
    const l = filesLineOf(v);
    assert.deepEqual([l.marker, l.text, keys(l), l.startHeld], [marker, text, offered, held], name);
  }
});

test("Find music files is offered only while a file is missing or a search runs, and is held while one runs", () => {
  assert.equal(filesLineOf(fv(11, 0)).find, null, "never when all are found");
  assert.equal(filesLineOf(fv(11, 2)).find?.held, undefined);
  for (const phase of ["choosing", "finding", "checking"] as const) assert.equal(filesLineOf(fv(11, 2, { phase })).find?.held, true, phase);
});

test("the grey detail says what Start will do and why, and never names a folder or a path", () => {
  assert.equal(filesLineOf(fv(11, 0)).detail, "Starting plays them from this computer and opens the room screen and the presenter window");
  assert.equal(filesLineOf(fv(11, 2)).detail, "Starting opens the room screen and the presenter window. Manual clock until they are found");
  assert.equal(filesLineOf(fv(11, 1)).detail, "Starting opens the room screen and the presenter window. Manual clock until it is found");
  assert.equal(filesLineOf(fv(11, 2, { searched: true })).detail, "They were not in the folder you chose. Choose another folder, or start on the manual clock");
  assert.equal(filesLineOf(fv(11, 2, { phase: "choosing" })).detail, "A window from this computer is open. Starting waits until you have chosen");
  assert.equal(filesLineOf(fv(11, 2, { phase: "finding" })).detail, "Looking in the folder you chose and the folders inside it. Starting waits until this is done");
  assert.equal(filesLineOf(fv(11, 2, { phase: "checking" })).detail, "Looking for them on this computer. Starting waits until this is done", "a background check chose no folder");
  for (const v of [fv(11, 0), fv(11, 2), fv(11, 2, { searched: true }), fv(11, 2, { phase: "finding" }), fv(11, 2, { phase: "checking" })]) {
    const all = JSON.stringify(filesLineOf(v));
    assert.doesNotMatch(all, /[/\\]|C:|local|SHA|index|scan/i);
  }
});

test("a failed search: a plate with Try again, the previous words, and no grey detail", () => {
  const v = fv(11, 2, { failed: true });
  const plate = filesPlateOf(v)!;
  assert.deepEqual([plate.headline, plate.detail, plate.button?.label], ["The music files could not be searched", "Nothing was changed. Try again, or start on the manual clock.", "Try again"]);
  assert.equal(plate.button?.id, "files-find");
  const l = filesLineOf(v);
  assert.deepEqual([l.text, l.detail], ["2 music files are missing", null]);
  assert.equal(filesPlateOf(fv(11, 2)), null);
  assert.equal(filesPlateOf(fv(11, 2, { failed: true, phase: "finding" })), null, "a search that runs hides the old failure");
});

test("a row says Files found, N files missing, or Finding files", () => {
  assert.deepEqual(rowFilesOf(fv(11, 0)), { marker: "ok", text: "Files found" });
  assert.deepEqual(rowFilesOf(fv(11, 2)), { marker: "away", text: "2 files missing" });
  assert.deepEqual(rowFilesOf(fv(11, 1)), { marker: "away", text: "1 file missing" });
  assert.deepEqual(rowFilesOf(fv(11, 2, { phase: "finding" })), { marker: "work", text: "Finding files…" });
});

test("during a check, Show which files and Find music files are held (shown, disabled), not hidden (#955)", () => {
  const l = filesLineOf(fv(11, 2, { phase: "checking" }));
  assert.deepEqual([l.show?.label, l.show?.held, l.find?.label, l.find?.held], ["Show which files", true, "Find music files", true]);
});

test("a class with an answer keeps it while another class runs: its words and row stay, its keys and Start are held (#955)", () => {
  const v = fv(11, 2, { held: true });
  const l = filesLineOf(v);
  assert.deepEqual([l.text, l.marker, l.startHeld, l.find?.held, l.show?.held], ["2 music files are missing", "away", true, true, undefined]);
  assert.deepEqual(rowFilesOf(v), { marker: "away", text: "2 files missing" });
  const found = filesLineOf(fv(11, 0, { held: true }));
  assert.deepEqual([found.text, found.startHeld], ["All 11 music files are found", true]);
  assert.equal(filesListOf("Thursday threshold", v)!.buttons[0]!.held, true, "the panel's Find is held too");
});

test("the panel of the missing songs: the class title, the count, every song, Find (Enter) and Back (Esc)", () => {
  const p = filesListOf("Thursday threshold", fv(11, 2))!;
  assert.equal(p.heading, "Missing music files");
  assert.equal(p.sentence, "Thursday threshold: 2 of 11 music files are not found on this computer.");
  assert.deepEqual(p.songs, some(2));
  assert.deepEqual(p.buttons.map((b) => [b.id, b.label, b.key, b.primary]), [["files-find", "Find music files", "Enter", true], ["files-back", "Back", "Esc", false]]);
  assert.equal(filesListOf("T", fv(11, 0)), null, "nothing missing: no panel");
  assert.equal(filesListOf("T", fv(11, 2, { phase: "finding" }))!.buttons[0]!.held, true);
});

// ---------- The class list's screen ----------
const local = (title: string, n: number) => row(title, n, { source: "local", songs: 11 });
const ROWS = [row("Alpha", 1), local("Bravo", 2), local("Charlie", 3)];
const filesOf = (r: (typeof ROWS)[number], over: Partial<FilesView> = {}): FilesView => ({ ...fv(11, 2), id: r.id, hash: r.hash, ...over });
const screen = (files: FilesView[], ui: { selectedId?: string | null; filesOpen?: string | null } = {}) =>
  screenOf(view({ rows: ROWS, sync: { ...SYNCED, classes: 3 }, files }), { filter: "", selectedId: ui.selectedId ?? ROWS[1]!.id, lastStartedId: null, filesOpen: ui.filesOpen ?? null }, NOW);

test("a local class is a row of its own kind: 'Music files, 11 songs', never 'needs a newer player', and startable", () => {
  const s = screen([filesOf(ROWS[1]!)]);
  assert.equal(s.body.kind, "list");
  if (s.body.kind !== "list") return;
  const bravo = s.body.rows.find((r) => r.title === "Bravo")!;
  assert.equal(bravo.meta, "Music files, 11 songs");
  assert.deepEqual(bravo.files, { marker: "away", text: "2 files missing" });
  assert.equal(s.body.rows.find((r) => r.title === "Alpha")!.files, null, "a Spotify row has no files marker");
  assert.equal(s.body.footer.disabled, false, "Start is never refused for missing files");
  assert.equal(s.body.footer.files?.text, "2 music files are missing");
  assert.equal(s.body.footer.detail, "Starting opens the room screen and the presenter window. Manual clock until they are found");
});

test("only the selected class's footer has the files line; another selection shows that class's own state", () => {
  const files = [filesOf(ROWS[1]!), filesOf(ROWS[2]!, { missing: [] })];
  const a = screen(files, { selectedId: ROWS[0]!.id });
  if (a.body.kind === "list") assert.equal(a.body.footer.files, null, "a Spotify class");
  const c = screen(files, { selectedId: ROWS[2]!.id });
  if (c.body.kind === "list") assert.equal(c.body.footer.files?.text, "All 11 music files are found");
});

test("while a search runs, Start is held and the footer points at the reason", () => {
  const s = screen([filesOf(ROWS[1]!, { phase: "finding" })]);
  if (s.body.kind !== "list") return assert.fail();
  assert.equal(s.body.footer.disabled, true);
  assert.equal(s.body.footer.describedBy, "foot-detail");
});

test("the failed search plate stands above the list, and the filter steps aside so five rows stay whole", () => {
  const many = Array.from({ length: 10 }, (_, i) => (i === 3 ? local("Local", 4) : row(`Class ${i}`, 10 + i)));
  const f: FilesView = { ...fv(11, 2, { failed: true }), id: many[3]!.id, hash: many[3]!.hash };
  const s = screenOf(view({ rows: many, sync: { ...SYNCED, classes: 10 }, files: [f] }), { filter: "x", selectedId: many[3]!.id, lastStartedId: null }, NOW);
  assert.equal(s.filesPlate?.headline, "The music files could not be searched");
  assert.equal(s.filter, null);
  const ok = screenOf(view({ rows: many, sync: { ...SYNCED, classes: 10 }, files: [{ ...f, failed: false }] }), { filter: "", selectedId: many[3]!.id, lastStartedId: null }, NOW);
  assert.equal(ok.filesPlate, null);
  assert.notEqual(ok.filter, null);
});

test("Show which files takes the body: the panel in place of the list and footer; nothing missing closes it", () => {
  const s = screen([filesOf(ROWS[1]!)], { filesOpen: ROWS[1]!.id });
  assert.equal(s.body.kind, "files-list");
  const none = screen([filesOf(ROWS[1]!, { missing: [] })], { filesOpen: ROWS[1]!.id });
  assert.equal(none.body.kind, "list", "all found after a search: back to the list");
  const other = screen([filesOf(ROWS[1]!)], { filesOpen: ROWS[2]!.id });
  assert.equal(other.body.kind, "list", "the panel is for the selected class only");
});

test("what a screen reader hears follows the files line", () => {
  assert.equal(screen([filesOf(ROWS[1]!)]).announce, "2 music files are missing");
  assert.equal(screen([filesOf(ROWS[1]!, { phase: "choosing" })]).announce, "Choose the folder with your music");
  assert.equal(screen([filesOf(ROWS[1]!, { failed: true })]).announce, "The music files could not be searched");
});
