// The class list's data (core/sync/class-list.ts, updated-text.ts): the rows, their order and
// their fields, and the "Updated" text. Both modules are pure: they import no I/O.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classListView } from "../../src/core/sync/class-list.ts";
import { INITIAL } from "../../src/core/sync/sync-model.ts";
import type { SyncState } from "../../src/core/sync/sync-model.ts";
import { updatedText } from "../../src/core/sync/updated-text.ts";

const H = (n: number): string => `sha256:${String(n).repeat(64)}`;
const id = (n: number): string => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const T = "2026-11-01T10:00:00+00:00";

function doc(title: string, over: { sport?: string; source?: string; songs?: number; length?: number } = {}): Record<string, unknown> {
  return {
    format_version: "1.0",
    class: { title, sport: over.sport ?? "cycling", length_ms: over.length ?? 2_520_000, secret_note: "not for the window" },
    music: { source: over.source ?? "spotify" },
    songs: Array.from({ length: over.songs ?? 11 }, (_, i) => ({ title: `song ${i}` })),
    cues: [{ text: "never copied into a row" }],
  };
}

/** A state holding the classes `[n, title]`, version n, and the documents for them. */
function listed(classes: [number, string][], over: Partial<SyncState> = {}) {
  const held = new Map(classes.map(([n]) => [id(n), H(n)]));
  const published = new Map(classes.map(([n]) => [id(n), T]));
  const docs = new Map(classes.map(([n, title]) => [id(n), doc(title)]));
  return { state: { ...INITIAL, unread: false, held, published, ...over } as SyncState, docs };
}
const titlesOf = (rows: readonly { title: string }[]): string[] => rows.map((r) => r.title);

test("a row has the title, length, sport, source, songs, time and the version, and nothing else", () => {
  const { state, docs } = listed([[1, "Thursday threshold"]]);
  assert.deepEqual(classListView(state, docs), [
    { id: id(1), hash: H(1), title: "Thursday threshold", lengthMs: 2_520_000, sport: "cycling", source: "spotify", songs: 11, updated: T, playing: false, newer: false, notUpdated: false },
  ]);
});

test("the sport, the music source and the song count come from the document", () => {
  const { state } = listed([[1, "Hills"], [2, "Easy"], [3, "Clock"]]);
  const docs = new Map([
    [id(1), doc("Hills", { sport: "running", source: "swedebeat", songs: 9 })],
    [id(2), doc("Easy", { songs: 0, source: "none" })],
    [id(3), doc("Clock", { source: "none", songs: 0, length: 60_000 })],
  ]);
  const rows = classListView(state, docs);
  assert.deepEqual(rows.map((r) => [r.title, r.sport, r.source, r.songs, r.lengthMs]), [
    ["Clock", "cycling", "none", 0, 60_000],
    ["Easy", "cycling", "none", 0, 2_520_000],
    ["Hills", "running", "swedebeat", 9, 2_520_000],
  ]);
});

test("the order is the title's A to Z without regard to case, never by time or id first", () => {
  const { state, docs } = listed([[1, "zone ride"], [2, "Alpine"], [3, "beat 100"], [4, "Beat 20"]]);
  assert.deepEqual(titlesOf(classListView(state, docs)), ["Alpine", "beat 100", "Beat 20", "zone ride"]);
  // A newer time does not move a row.
  const later = { ...state, published: new Map([[id(1), "2030-01-01T00:00:00Z"]]) };
  assert.deepEqual(titlesOf(classListView(later, docs)), ["Alpine", "beat 100", "Beat 20", "zone ride"]);
});

test("equal titles are ordered by id, whatever the order the cache listed them in", () => {
  const a = listed([[3, "Tempo"], [1, "Tempo"], [2, "tempo"]]);
  assert.deepEqual(classListView(a.state, a.docs).map((r) => r.id), [id(1), id(2), id(3)]);
  const b = listed([[1, "Tempo"], [2, "tempo"], [3, "Tempo"]]);
  assert.deepEqual(classListView(b.state, b.docs).map((r) => r.id), [id(1), id(2), id(3)]);
});

test("non-ASCII titles sort by their base letter, accents ignored", () => {
  const { state, docs } = listed([[1, "Zebra"], [2, "Åsa"], [3, "Émile"], [4, "Dora"], [5, "Örjan"], [6, "Ärlig"], [7, "ångest"], [8, "Ünal"]]);
  assert.deepEqual(titlesOf(classListView(state, docs)), ["ångest", "Ärlig", "Åsa", "Dora", "Émile", "Örjan", "Ünal", "Zebra"]);
  // An accented and a plain spelling of one title are equal titles: by id.
  const same = listed([[2, "Cafe"], [1, "Café"]]);
  assert.deepEqual(classListView(same.state, same.docs).map((r) => r.id), [id(1), id(2)]);
});

test("the class being played is marked, in its own place, and newer when sync holds another version", () => {
  const plain = listed([[1, "A"], [2, "B"], [3, "C"]], { pinned: { id: id(2), hash: H(2) } });
  assert.deepEqual(classListView(plain.state, plain.docs).map((r) => [r.title, r.playing, r.newer]), [["A", false, false], ["B", true, false], ["C", false, false]]);
  const newer = listed([[1, "A"], [2, "B"]], { pinned: { id: id(2), hash: H(9) } });
  assert.deepEqual(classListView(newer.state, newer.docs).map((r) => [r.title, r.playing, r.newer]), [["A", false, false], ["B", true, true]]);
});

test("the not-updated mark and an unknown time are carried per class", () => {
  const { state, docs } = listed([[1, "A"], [2, "B"]], { notUpdated: new Set([id(2), id(7)]), published: new Map([[id(1), T]]) });
  assert.deepEqual(classListView(state, docs).map((r) => [r.title, r.notUpdated, r.updated]), [["A", false, T], ["B", true, null]]);
});

test("a class with no document that reads as a class has no row, and nothing is guessed", () => {
  const { state, docs } = listed([[1, "A"], [2, "B"], [3, "C"], [4, "D"]]);
  docs.delete(id(1));
  docs.set(id(2), { class: { title: 5 } });
  docs.set(id(3), { ...doc("C"), songs: "none" });
  assert.deepEqual(titlesOf(classListView(state, docs)), ["D"]);
  assert.deepEqual(classListView(INITIAL, new Map()), []);
});

test("rows carry no field of the document beyond the ones listed", () => {
  const { state, docs } = listed([[1, "A"]]);
  const row = classListView(state, docs)[0];
  assert.deepEqual(Object.keys(row).sort(), ["hash", "id", "lengthMs", "newer", "notUpdated", "playing", "songs", "source", "sport", "title", "updated"]);
  assert.equal(JSON.stringify(row).includes("not for the window"), false);
  assert.equal(JSON.stringify(row).includes("never copied"), false);
});

/** The local time `y-m-d h:min` as the ISO stamp the server would send. */
const at = (y: number, m: number, d: number, h = 12, min = 0): string => new Date(y, m - 1, d, h, min).toISOString();
const clock = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime();

test("the updated text: today, yesterday, a date, and a date with the year", () => {
  const now = clock(2026, 11, 13, 15, 30);
  const table: [string, string][] = [
    [at(2026, 11, 13, 0, 0), "Today"],
    [at(2026, 11, 13, 15, 30), "Today"],
    [at(2026, 11, 12, 23, 59), "Yesterday"],
    [at(2026, 11, 12, 0, 0), "Yesterday"],
    [at(2026, 11, 11, 23, 59), "11 Nov"],
    [at(2026, 11, 9), "9 Nov"],
    [at(2026, 1, 1, 0, 0), "1 Jan"],
    [at(2025, 12, 14), "14 Dec 2025"],
    [at(2025, 11, 13), "13 Nov 2025"],
  ];
  for (const [stamp, text] of table) assert.equal(updatedText(stamp, now), text, `${stamp} at ${new Date(now).toString()}`);
});

test("the updated text follows the local date across midnight and the new year", () => {
  assert.equal(updatedText(at(2026, 11, 13, 23, 50), clock(2026, 11, 13, 23, 59)), "Today");
  assert.equal(updatedText(at(2026, 11, 13, 23, 50), clock(2026, 11, 14, 0, 5)), "Yesterday");
  assert.equal(updatedText(at(2026, 11, 13, 23, 50), clock(2026, 11, 15, 0, 5)), "13 Nov");
  // Over the year change: yesterday is still yesterday, a day before is dated with its year.
  assert.equal(updatedText(at(2025, 12, 31, 22, 0), clock(2026, 1, 1, 0, 10)), "Yesterday");
  assert.equal(updatedText(at(2025, 12, 31, 22, 0), clock(2026, 1, 2, 9, 0)), "31 Dec 2025");
  assert.equal(updatedText(at(2025, 12, 31, 22, 0), clock(2025, 12, 31, 23, 0)), "Today");
  // A leap day, and a month with 31 days before a month with 30.
  assert.equal(updatedText(at(2028, 2, 29), clock(2028, 3, 1, 8)), "Yesterday");
  assert.equal(updatedText(at(2026, 10, 31), clock(2026, 11, 1, 8)), "Yesterday");
});

test("a time that is not known, or is not a time, shows nothing", () => {
  assert.equal(updatedText(null, clock(2026, 11, 13)), null);
  assert.equal(updatedText("not a time", clock(2026, 11, 13)), null);
  assert.equal(updatedText(at(2026, 11, 13), Number.NaN), null);
});

test("the pure modules import no I/O: no database, network, filesystem, process, window or React", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "core", "sync");
  for (const name of ["class-list.ts", "updated-text.ts", "fault-policy.ts", "view.ts"]) {
    const source = readFileSync(join(dir, name), "utf8");
    const imports = [...source.matchAll(/^import .* from "(.*)";$/gm)].map((m) => m[1]);
    assert.deepEqual(imports.filter((from) => !from.startsWith("./")), [], name);
    assert.equal(/\b(fetch|process|require|electron)\b\s*[.(]/.test(source), false, name);
    assert.ok(source.split("\n").length <= 150, `${name} is over 150 lines`);
  }
});
