// The class list's pure model (core/list/): the filter's folding, the count and "n of N", the
// states and their words, the class being played (also when its cached copy is removed), and the
// keyboard moves. Table-driven; no page, no shell.
import assert from "node:assert/strict";
import { test } from "node:test";
import { filterRows, fold } from "../../src/core/list/filter.ts";
import { listRows, snapshotOf } from "../../src/core/list/rows.ts";
import { screenOf } from "../../src/core/list/screen.ts";
import type { Screen } from "../../src/core/list/screen.ts";
import { jumpToLetter, keepSelection, moveSelection } from "../../src/core/list/selection.ts";
import { LASTING_HEADLINE, LASTING_TEXT } from "../../src/core/list/states.ts";
import type { ListUi } from "../../src/core/list/view.ts";
import { NOTICE_TEXT } from "../../src/core/pairing/view.ts";
import { NOW, PAIRED, row, rows, view } from "./list-fixtures.ts";

const UI: ListUi = { filter: "", selectedId: null, lastStartedId: null };
const screen = (v = view(), ui: Partial<ListUi> = {}): Screen => screenOf(v, { ...UI, ...ui }, NOW);
const titlesOf = (s: Screen): string[] => (s.body.kind === "list" ? s.body.rows.map((r) => r.title) : []);

const NAMES = ["Café ride", "Thursday threshold", "Zürich zone work", "Ångström intervals", "straße endurance", "Monday morning endurance", "Tempo", "Pyramid", "Recovery"];

test("the filter folds case and accents the way the sort does", () => {
  const all = rows(NAMES);
  const cases: [string, string[]][] = [
    ["cafe", ["Café ride"]],
    ["CAFÉ", ["Café ride"]],
    ["zurich", ["Zürich zone work"]],
    ["ÜRICH", ["Zürich zone work"]],
    ["angstrom", ["Ångström intervals"]],
    ["ENDURANCE", ["straße endurance", "Monday morning endurance"]],
    ["  tempo  ", ["Tempo"]],
    ["", NAMES],
    ["   ", NAMES],
    ["zzz", []],
  ];
  for (const [text, want] of cases) assert.deepEqual(new Set(filterRows(all, text).map((r) => r.title)), new Set(want), text);
  assert.equal(fold("Crème Brûlée"), "creme brulee");
});

test("the count reads 1 class or n classes, and the filter shows from eight classes with n of N", () => {
  assert.equal(screen(view({ rows: rows(["A"]) })).count, "1 class");
  const seven = screen(view({ rows: rows(NAMES.slice(0, 7)) }));
  assert.equal(seven.count, "7 classes");
  assert.equal(seven.filter, null);
  const eight = screen(view({ rows: rows(NAMES.slice(0, 8)) }));
  assert.deepEqual(eight.filter, { of: null });
  const typed = screen(view({ rows: rows(NAMES) }), { filter: "endurance" });
  assert.deepEqual(typed.filter, { of: "2 of 9" });
  assert.equal(typed.count, "9 classes");
  assert.deepEqual(titlesOf(typed).sort(), ["Monday morning endurance", "straße endurance"]);
});

test("a filter with no match replaces the list and the footer with a panel", () => {
  const s = screen(view({ rows: rows(NAMES) }), { filter: "qqq" });
  assert.equal(s.body.kind, "panel");
  if (s.body.kind === "panel") {
    assert.equal(s.body.panel.heading, "No class matches “qqq”");
    assert.equal(s.body.panel.text, "Check the spelling, or press Esc to clear the filter.");
  }
  assert.deepEqual(s.filter, { of: "0 of 9" });
});

test("rows show title, length, the second line and when updated; running comes first; no hue is carried", () => {
  const r = [row("Manual", 1, { source: "none", songs: 0 }), row("Run", 2, { sport: "running", lengthMs: 3_725_000, songs: 1, updated: "2025-12-14T09:00:00+00:00" })];
  const s = screen(view({ rows: r }));
  if (s.body.kind !== "list") throw new Error("a list");
  assert.deepEqual(s.body.rows.map((x) => [x.meta, x.length, x.updated]), [["Manual clock, no music", "45:00", "9 Nov"], ["Running, Spotify, 1 song", "1:02:05", "14 Dec 2025"]]);
  assert.equal(s.body.footer.action, "start");
  assert.equal(s.body.footer.button.label, "Start class");
  assert.equal(s.selectedId, r[0].id, "the first row is selected at first");
});

test("the selection stays on the same class when rows change, and the class being played holds it", () => {
  const ids = ["a", "b", "c"];
  assert.equal(keepSelection(ids, "b", null, null), "b");
  assert.equal(keepSelection(ids, "gone", null, "c"), "c");
  assert.equal(keepSelection(ids, "gone", null, "nope"), "a");
  assert.equal(keepSelection(ids, "b", "c", null), "c");
  assert.equal(keepSelection([], "b", null, null), null);
});

test("keys: up, down, home, end and the pages move the selection, never past the ends", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const t: [Parameters<typeof moveSelection>[2], string | null, string][] = [
    ["down", "a", "b"], ["down", "f", "f"], ["up", "a", "a"], ["up", "c", "b"], ["home", "d", "a"], ["end", "b", "f"], ["pagedown", "a", "d"], ["pageup", "e", "b"], ["down", null, "a"],
  ];
  for (const [m, from, to] of t) assert.equal(moveSelection(ids, from, m, 4), to, `${m} from ${from}`);
  assert.equal(moveSelection([], null, "down", 4), null);
  const named = rows(["Alpha", "Beta", "Bravo", "Charlie"]);
  assert.equal(jumpToLetter(named, named[0].id, "b"), named[1].id);
  assert.equal(jumpToLetter(named, named[1].id, "b"), named[2].id);
  assert.equal(jumpToLetter(named, named[2].id, "b"), named[1].id, "wraps");
  assert.equal(jumpToLetter(named, named[0].id, "x"), named[0].id);
});

test("a class being played keeps its A to Z place, is marked, and every other class is greyed", () => {
  const r = rows(["Alpha", "Bravo", "Charlie"]).map((x, i) => (i === 1 ? { ...x, playing: true, newer: true } : x));
  const s = screen(view({ rows: r, sync: { classes: 3, pinned: { id: r[1].id, after: "newer" } } }));
  if (s.body.kind !== "list") throw new Error("a list");
  assert.deepEqual(titlesOf(s), ["Alpha", "Bravo", "Charlie"]);
  assert.deepEqual(s.body.rows.map((x) => [x.tags, x.dim, x.selected]), [[[], true, false], [["Playing now", "Newer version after this class"], false, true], [[], true, false]]);
  assert.equal(s.body.footer.action, "back");
  assert.equal(s.body.footer.button.label, "Back to the class");
  assert.equal(s.body.footer.detail, "Other classes can start when this one has ended");
  // The selection cannot leave the class being played.
  assert.equal(screen(view({ rows: r, sync: { classes: 3, pinned: { id: r[1].id, after: "newer" } } }), { selectedId: r[0].id }).selectedId, r[1].id);
});

test("a playing class whose cached copy was removed stays on the list as the snapshot, in its own place", () => {
  const cached = rows(["Alpha", "Charlie"]);
  const gone = row("Bravo", 9, { playing: true });
  const snapshot = snapshotOf(gone);
  const pinned = { id: gone.id, after: "removed" as const };
  const shown = listRows(cached, pinned, snapshot);
  assert.deepEqual(shown.map((r) => [r.title, r.removed, r.playing]), [["Alpha", false, false], ["Bravo", true, true], ["Charlie", false, false]]);
  const s = screen(view({ rows: shown, sync: { classes: 2, pinned } }));
  if (s.body.kind !== "list") throw new Error("a list");
  assert.deepEqual(s.body.rows[1].tags, ["Playing now", "Removed: plays to the end"]);
  assert.equal(s.body.rows[1].length, "45:00");
  assert.equal(s.count, "2 classes", "the removed class is not a cached class");
  // Not pinned any more, or pinned to another class: no snapshot row.
  assert.deepEqual(listRows(cached, null, snapshot).map((r) => r.title), ["Alpha", "Charlie"]);
  assert.deepEqual(listRows(cached, { id: "other", after: "removed" }, snapshot).map((r) => r.title), ["Alpha", "Charlie"]);
  // A cached row of the same id wins over the snapshot.
  assert.equal(listRows([...cached, gone], pinned, snapshot).filter((r) => r.id === gone.id).length, 1);
});

test("a class that could not be updated carries its tag and still starts", () => {
  const s = screen(view({ rows: [row("Alpha", 1, { notUpdated: true })], sync: { notUpdated: ["x"] } }));
  if (s.body.kind !== "list") throw new Error("a list");
  assert.deepEqual(s.body.rows[0].tags, ["Could not be updated: older copy shown"]);
  assert.equal(s.body.rows[0].dim, false);
  assert.equal(s.body.footer.action, "start");
});

test("the filter steps aside while a file's error plate is up, and does not narrow the list unseen", () => {
  const error = { message: "m", fileName: "x.json", details: [] };
  const s = screen(view({ rows: rows(NAMES), fileError: error }), { filter: "tempo" });
  assert.equal(s.filter, null);
  assert.equal(titlesOf(s).length, NAMES.length);
  // Fewer than eight classes: a filter typed earlier no longer applies either.
  assert.equal(titlesOf(screen(view({ rows: rows(NAMES.slice(0, 3)) }), { filter: "tempo" })).length, 3);
});

test("a file that did not open is a second plate with the file's name and at most five details", () => {
  const s = screen(view({ rows: rows(["A"]), fileError: { message: "This class file is not valid.", fileName: "x.json", details: ["1", "2", "3", "4", "5", "6"] } }));
  assert.equal(s.filePlate?.headline, "This class file is not valid.");
  assert.equal(s.filePlate?.detail, "x.json was not opened.");
  assert.equal(s.filePlate?.lines.length, 5);
  assert.equal(s.filePlate?.button?.label, "Close");
  assert.equal(s.body.kind, "list", "the list is as it was");
});

type Case = [name: string, v: ReturnType<typeof view>, panel: string | null, line: string];

const some = rows(["Alpha", "Bravo"]);
const CASES: Case[] = [
  ["up to date", view({ rows: some }), null, "Up to date"],
  ["syncing with classes", view({ rows: some, sync: { status: "syncing" } }), null, "Syncing"],
  ["first sync", view({ sync: { status: "syncing" } }), "first-sync", "Syncing"],
  ["offline", view({ rows: some, sync: { status: "offline" } }), null, "Offline"],
  ["waiting", view({ rows: some, sync: { status: "waiting" } }), null, "Sync is waiting"],
  ["unavailable", view({ sync: { status: "unavailable", unavailable: "passing" } }), "unavailable", "The saved classes could not be read"],
  ["expired", view({ rows: some, sync: { status: "expired" }, pairing: { ...PAIRED, pairAgain: true } }), null, "The pairing with ana@example.com has run out"],
  ["not paired", view({ sync: { status: "unpaired" }, pairing: { state: "unpaired", message: null } }), "not-paired", "Not paired"],
  ["asking", view({ pairing: { state: "starting" } }), "pairing-start", "Asking the server for a code…"],
  ["pairing", view({ pairing: { state: "waiting", userCode: "WDJB-MJHT", page: "https://p.example/pair", secondsLeft: 581 } }), "pairing", "Waiting for the code to be confirmed on the website"],
  ["revoked", view({ sync: { status: "unpaired" }, pairing: { state: "unpaired", message: NOTICE_TEXT.revoked_on_site } }), "revoked", NOTICE_TEXT.revoked_on_site],
  ["wiping", view({ sync: { status: "unpaired", wiping: true }, pairing: { state: "unpaired", message: null } }), "wiping", "Clearing the saved classes"],
  ["empty", view(), "empty", "Up to date"],
];

test("every state shows its words, and the body is chosen in the spec's order", () => {
  for (const [name, v, panel, line] of CASES) {
    const s = screen(v);
    assert.equal(s.body.kind === "panel" ? s.body.panel.kind : null, panel, name);
    assert.equal(s.status?.text ?? s.plate?.headline, line, name);
    assert.equal(s.announce, line, name);
  }
  // A cache that cannot be read wins over a wipe, a wipe over pairing, pairing over everything else.
  const all = view({ rows: some, sync: { status: "unavailable", unavailable: "lasting", wiping: true }, pairing: { state: "starting" } });
  assert.equal(screen(all).plate?.headline, LASTING_HEADLINE);
  assert.equal(screen({ ...all, sync: { ...all.sync, unavailable: "passing" } }).plate?.headline, "The saved classes could not be read");
  assert.equal(screen({ ...all, sync: { ...all.sync, status: "unpaired", unavailable: null } }).status?.text, "Clearing the saved classes");
  assert.equal(screen({ ...all, sync: { ...all.sync, status: "synced", unavailable: null, wiping: false } }).status?.text, "Asking the server for a code…");
});

test("a lasting fault says what to do; a passing one says it will be tried again", () => {
  const lasting = screen(view({ sync: { status: "unavailable", unavailable: "lasting" } }));
  assert.equal(lasting.plate?.detail, LASTING_TEXT);
  assert.equal(lasting.plate?.headline, LASTING_HEADLINE);
  assert.equal(LASTING_TEXT, "They are still on this computer, but the player cannot reach them. Restart the app; if it keeps happening, reinstall it.");
  assert.equal(LASTING_HEADLINE, "The saved classes cannot be reached");
  assert.doesNotMatch(LASTING_TEXT + LASTING_HEADLINE, /read|updated|'/, "one fault, no straight apostrophe");
  const passing = screen(view({ sync: { status: "unavailable", unavailable: "passing" } }));
  assert.match(passing.plate?.detail ?? "", /Trying again soon/);
  assert.equal(lasting.body.kind === "panel" && lasting.body.panel.buttons.length, 0, "no pairing button, no start");
});

test("pairing shows the code, the page, the countdown and Cancel; a pairing that ran out keeps the list", () => {
  const s = screen(CASES.find((c) => c[0] === "pairing")![1]);
  if (s.body.kind !== "panel") throw new Error("a panel");
  assert.equal(s.body.panel.code, "WDJB-MJHT");
  assert.equal(s.body.panel.note, "The code runs out in 9:41");
  assert.deepEqual(s.body.panel.buttons.map((b) => b.label), ["Open the page again", "Cancel"]);
  const expired = screen(CASES.find((c) => c[0] === "expired")![1]);
  assert.equal(expired.body.kind, "list");
  assert.equal(expired.plate?.button?.label, "Pair again");
  // Another notice is shown verbatim, and only the two removal notices say the classes were removed.
  const other = screen(view({ sync: { status: "unpaired" }, pairing: { state: "unpaired", message: NOTICE_TEXT.unreachable } }));
  assert.equal(other.plate?.headline, NOTICE_TEXT.unreachable);
  assert.equal(other.plate?.detail, null);
});

test("the screen carries no hue and no word of rider data", () => {
  const text = JSON.stringify(CASES.map(([, v]) => screen(v)));
  assert.doesNotMatch(text, /#[0-9a-f]{6}|rgb|zone|rider|popular|last taught/i);
});
