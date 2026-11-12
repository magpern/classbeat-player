// The shell's state: opening classes, commands, and a refused file keeping the open class.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { NEWER_VERSION_MESSAGE } from "../../src/core/class-file.ts";
import { advance, command, INITIAL, openText, refuse, snapshotOf } from "../../src/core/player-state.ts";
import { classSchema, converterExamples, EXAMPLES } from "./fixtures.ts";

const good = readFileSync(converterExamples()[0], "utf8");
const newer = readFileSync(join(EXAMPLES, "reader", "rejected-unknown-major.json"), "utf8");

test("before any class: no view, commands do nothing", () => {
  const s = command(INITIAL, { type: "start" }, 0);
  assert.deepEqual(snapshotOf(s, 0), { loadId: 0, fileName: null, doc: null, view: null, error: null });
});

test("opening a class gives a ready clock at 0", () => {
  const s = openText(INITIAL, "a.json", good, classSchema, 0);
  const snap = snapshotOf(s, 5000);
  assert.equal(snap.loadId, 1);
  assert.equal(snap.fileName, "a.json");
  assert.equal(snap.view?.status, "ready");
  assert.equal(snap.view?.classMs, 0);
  assert.equal(snap.error, null);
});

test("a refused file keeps the open class and its running clock (ADR 0003 section 7)", () => {
  let s = openText(INITIAL, "a.json", good, classSchema, 0);
  s = command(s, { type: "start" }, 0);
  s = advance(s, 10_000);
  const before = s.loaded;
  s = openText(s, "new.json", newer, classSchema, 10_000);
  assert.equal(s.loaded, before);
  const snap = snapshotOf(s, 12_000);
  assert.equal(snap.fileName, "a.json");
  assert.equal(snap.view?.status, "running");
  assert.equal(snap.view?.classMs, 12_000);
  assert.deepEqual(snap.error, { message: NEWER_VERSION_MESSAGE, details: [] });
});

test("an unreadable file keeps the open class too", () => {
  const s0 = openText(INITIAL, "a.json", good, classSchema, 0);
  const s = refuse(s0, "This file could not be read.");
  assert.equal(s.loaded, s0.loaded);
  assert.equal(s.error?.message, "This file could not be read.");
});

test("opening another class replaces the clock and clears the error", () => {
  let s = openText(INITIAL, "a.json", good, classSchema, 0);
  s = command(s, { type: "start" }, 0);
  s = openText(s, "x.json", "nope", classSchema, 1000);
  s = openText(s, "b.json", good, classSchema, 2000);
  const snap = snapshotOf(s, 9000);
  assert.equal(snap.loadId, 2);
  assert.equal(snap.fileName, "b.json");
  assert.equal(snap.view?.status, "ready");
  assert.equal(snap.error, null);
});

test("commands reach the clock: start, pause, next", () => {
  let s = openText(INITIAL, "a.json", good, classSchema, 0);
  s = command(s, { type: "start" }, 0);
  s = command(s, { type: "pause" }, 3000);
  s = command(s, { type: "next" }, 4000);
  const v = snapshotOf(s, 9000).view;
  assert.equal(v?.status, "paused");
  assert.equal(v?.intervalIndex, 1);
  assert.equal(v?.intervalElapsedMs, 0);
});
