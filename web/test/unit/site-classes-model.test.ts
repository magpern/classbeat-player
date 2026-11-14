// The class list's model (src/site/core/classes-model.ts): the order is the title's, never the
// date or use (rules 10 and 13); removal markers are not shown; the filter ignores case and accents.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { changedText, countText, filtered, filterNote, pageOf, sorted } from "../../src/site/core/classes-model.ts";
import type { Row } from "../../src/site/core/classes-model.ts";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, title: string, changedAt = "2026-01-01T00:00:00Z"): Row => ({ id: id(n), title, lengthMs: 60_000, source: "classbeat", changedAt });
const titles = (rows: readonly Row[]): string[] => rows.map((r) => r.title);

describe("the sort", () => {
  const table: readonly (readonly [string, readonly Row[], readonly string[]])[] = [
    ["plain A to Z", [row(1, "Tempo"), row(2, "Endurance"), row(3, "Climb")], ["Climb", "Endurance", "Tempo"]],
    ["case ignored", [row(1, "banana"), row(2, "Apple"), row(3, "cherry"), row(4, "Avocado")], ["Apple", "Avocado", "banana", "cherry"]],
    ["accents ignored", [row(1, "Zebra"), row(2, "Éclair"), row(3, "eagle"), row(4, "Ångström")], ["Ångström", "eagle", "Éclair", "Zebra"]],
  ];
  for (const [name, input, want] of table) {
    it(name, () => {
      assert.deepEqual(titles(sorted(input)), want);
    });
  }

  it("puts equal titles in id order, whatever came first", () => {
    const rows = [row(3, "Same"), row(1, "same"), row(2, "SAME")];
    assert.deepEqual(sorted(rows).map((r) => r.id), [id(1), id(2), id(3)]);
    assert.deepEqual(sorted([...rows].reverse()).map((r) => r.id), [id(1), id(2), id(3)]);
  });

  it("treats a composed and a decomposed accent as the same letter, so the id decides", () => {
    const rows = [row(2, "Etude"), row(1, "E\u0301tude"), row(3, "\u00c9tude")];
    assert.deepEqual(sorted(rows).map((r) => r.id), [id(1), id(2), id(3)]);
  });

  it("never orders by date: the newest and the oldest keep their title's place", () => {
    const rows = [row(1, "B", "2020-01-01T00:00:00Z"), row(2, "A", "2026-11-13T00:00:00Z"), row(3, "C", "2023-06-01T00:00:00Z")];
    assert.deepEqual(titles(sorted(rows)), ["A", "B", "C"]);
    assert.deepEqual(titles(sorted([...rows].reverse())), ["A", "B", "C"]);
  });

  it("never orders by length or by source", () => {
    const rows = [{ ...row(1, "B"), lengthMs: 1 }, { ...row(2, "A"), lengthMs: 99_000_000 }, { ...row(3, "C"), source: "a" }];
    assert.deepEqual(titles(sorted(rows)), ["A", "B", "C"]);
  });

  it("leaves its input alone", () => {
    const rows = [row(1, "B"), row(2, "A")];
    sorted(rows);
    assert.deepEqual(titles(rows), ["B", "A"]);
  });
});

describe("a page of the route", () => {
  const entry = (n: number, over: Record<string, unknown> = {}) => ({ class_id: id(n), source: "classbeat", title: `Class ${n}`, length_ms: 1000, changed_at: "2026-11-01T00:00:00Z", removed: false, ...over });

  it("reads the entries and the cursor of the next page", () => {
    const p = pageOf({ classes: [entry(1), entry(2)], cursor: "c1", more: true });
    assert.deepEqual(p?.rows.map((r) => r.id), [id(1), id(2)]);
    assert.equal(p?.next, "c1");
  });

  it("has no next page without `more`, or with an empty or missing cursor", () => {
    assert.equal(pageOf({ classes: [], cursor: "c1", more: false })?.next, null);
    assert.equal(pageOf({ classes: [], cursor: "", more: true })?.next, null);
    assert.equal(pageOf({ classes: [], more: true })?.next, null);
  });

  it("leaves out the markers of removed classes, which carry no title", () => {
    const p = pageOf({ classes: [entry(1), { class_id: id(2), removed: true, title: null, length_ms: null, changed_at: "2026-11-01T00:00:00Z" }], cursor: null, more: false });
    assert.deepEqual(p?.rows.map((r) => r.id), [id(1)]);
  });

  it("leaves out a class whose id is not a canonical id, which has no address", () => {
    const p = pageOf({ classes: [entry(1), entry(2, { class_id: "0000000a-0000-4000-8000-00000000000a".toUpperCase() }), entry(3, { class_id: "x" })], cursor: null, more: false });
    assert.deepEqual(p?.rows.map((r) => r.id), [id(1)]);
  });

  it("is null for anything that is not the route's shape", () => {
    for (const bad of [null, "x", 3, [], {}, { classes: "x" }, { classes: [entry(1, { title: 3 })] }, { classes: [entry(1, { length_ms: "1" })] }]) assert.equal(pageOf(bad), null, JSON.stringify(bad));
  });
});

describe("the filter", () => {
  const rows = [row(1, "Éclair ride"), row(2, "Hill repeats"), row(3, "Recovery spin")];
  it("ignores case, accents and the spaces around the text", () => {
    assert.deepEqual(titles(filtered(rows, "  ECLAIR ")), ["Éclair ride"]);
    assert.deepEqual(titles(filtered(rows, "xpeats")), []);
    assert.deepEqual(titles(filtered(rows, "REPEATS")), ["Hill repeats"]);
  });
  it("shows everything for nothing typed, in the same order", () => {
    assert.deepEqual(titles(filtered(rows, "")), titles(rows));
    assert.deepEqual(titles(filtered(rows, "   ")), titles(rows));
  });
  it("says what it did, in words, only when something is typed", () => {
    assert.equal(filterNote("", 3, 3), "");
    assert.equal(filterNote("zzz", 0, 12), "No class has that in its title");
    assert.equal(filterNote("rec", 1, 12), "1 of 12 classes");
  });
});

describe("the words", () => {
  it("counts classes", () => {
    assert.equal(countText(1), "1 class");
    assert.equal(countText(0), "0 classes");
    assert.equal(countText(12), "12 classes");
  });
  it("dates a change", () => {
    const now = new Date(2026, 10, 14, 12, 0, 0);
    assert.equal(changedText(new Date(2026, 10, 14, 8).toISOString(), now), "Today");
    assert.equal(changedText(new Date(2026, 10, 13, 8).toISOString(), now), "Yesterday");
    assert.equal(changedText(new Date(2026, 7, 2, 12).toISOString(), now), "2 Aug");
    assert.equal(changedText(new Date(2025, 11, 14, 12).toISOString(), now), "14 Dec 2025");
    assert.equal(changedText("not a date", now), "");
  });
});
