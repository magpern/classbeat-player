// The instructor's class list as native code answers it (issue #631): read strictly, nothing guessed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { facts, parseClassList, STATUS_WORDS } from "../src/modes/classes.ts";

const ID = "00000000-0000-4000-8000-000000000001";
const row = { id: ID, title: "Tempo builder", minutes: 45, songs: 11 };

test("a list answer becomes rows with their length and song count", () => {
  assert.deepEqual(parseClassList({ classes: [row], status: "synced" }), {
    classes: [{ id: ID, title: "Tempo builder", facts: "45 min · 11 songs", songs: 11 }],
    status: "synced",
  });
  assert.deepEqual(parseClassList({ classes: [], status: "offline" }), { classes: [], status: "offline" });
  assert.equal(facts(30, 1), "30 min · 1 song");
});

test("every status native code sends has its words, and the plates are the ones class-list.md names", () => {
  for (const s of ["syncing", "synced", "offline", "waiting", "expired", "unpaired", "unavailable"]) {
    assert.ok(parseClassList({ classes: [], status: s }), s);
  }
  assert.equal(STATUS_WORDS.synced.line, "Up to date");
  assert.equal(STATUS_WORDS.waiting.line, "Sync is waiting");
  const plates = Object.entries(STATUS_WORDS).filter(([, w]) => w.plate !== undefined).map(([s]) => s);
  assert.deepEqual(plates, ["expired", "unavailable"]);
});

test("any other shape is refused whole", () => {
  const bad: unknown[] = [
    undefined,
    null,
    [],
    "synced",
    { classes: [row] },
    { classes: [row], status: "SYNCED" },
    { classes: [row], status: "synced", token: "x" },
    { classes: {}, status: "synced" },
    { classes: [{ ...row, id: "1" }], status: "synced" },
    { classes: [{ ...row, title: "" }], status: "synced" },
    { classes: [{ ...row, minutes: 1.5 }], status: "synced" },
    { classes: [{ ...row, songs: -1 }], status: "synced" },
    { classes: [{ ...row, document: {} }], status: "synced" },
    { classes: [{ id: ID, title: "x", minutes: 1 }], status: "synced" },
  ];
  for (const b of bad) assert.equal(parseClassList(b), null, JSON.stringify(b));
});
