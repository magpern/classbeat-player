// The shell's state: opening classes, commands, and a refused file keeping the open class.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { NEWER_VERSION_MESSAGE } from "../../src/core/class-file.ts";
import { advance, command, INITIAL, isFollowing, openText, readerStopped, refuse, routeFor, snapshotOf, withoutReader } from "../../src/core/player-state.ts";
import { classSchema, converterExamples, EXAMPLES } from "./fixtures.ts";

const good = readFileSync(converterExamples()[0], "utf8");
const newer = readFileSync(join(EXAMPLES, "reader", "rejected-unknown-major.json"), "utf8");

test("before any class: no view, commands do nothing", () => {
  const s = command(INITIAL, { type: "start" }, 0);
  assert.deepEqual(snapshotOf(s, 0), { loadId: 0, fileName: null, doc: null, view: null, link: null, controls: null, band: null, pattern: null, error: null });
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

test("a reader that cannot work is reported as the reason, but not for a class that is manual only anyway", () => {
  const withReason = snapshotOf(withoutReader(openText(INITIAL, "a.json", good, classSchema, 0, true)), 0);
  assert.equal(withReason.link?.unavailable, true);
  assert.equal(withReason.link?.available, false);
  const noMusic = readFileSync(join(EXAMPLES, "valid", "short-class-no-music.json"), "utf8");
  const manualOnly = snapshotOf(withoutReader(openText(INITIAL, "b.json", noMusic, classSchema, 0, true)), 0);
  assert.equal(manualOnly.link?.unavailable, false, "nothing was to be followed, so there is nothing to explain");
});

test("a reader that stops while following hands over to the manual clock, announced, and can be followed again (issue #872)", () => {
  const following = command(openText(INITIAL, "a.json", good, classSchema, 0, true), { type: "start" }, 0);
  assert.equal(isFollowing(following), true);
  const stopped = readerStopped(following, 1000);
  assert.equal(isFollowing(stopped), false);
  const snap = snapshotOf(stopped, 1000);
  assert.equal(snap.link?.mode, "manual");
  assert.notEqual(snap.link?.announcement ?? null, null, "the hand-over is announced");
  assert.equal(snap.link?.available, true, "following can be picked again");
  assert.equal(snap.view?.classMs, snapshotOf(following, 1000).view?.classMs, "the clock is not moved");
  // On the manual clock already: nothing changes.
  assert.equal(readerStopped(stopped, 2000), stopped);
  assert.equal(readerStopped(INITIAL, 0), INITIAL);
});

test("the snapshot's band routes come from the same link and transport as the commands (issue #198)", () => {
  const s = openText(INITIAL, "a.json", good, classSchema, 0);
  for (const canSend of [true, false]) {
    const snap = snapshotOf(s, 0, canSend);
    for (const type of ["start", "pause", "resume", "next", "previous"] as const) {
      const r = routeFor(s, { type }, canSend);
      const expected = r === null || (r.kind === "transport" && r.alsoClock === true) ? "clock" : r.kind === "manual" ? "handover" : "music";
      assert.equal(snap.band?.[type], expected, `${type} ${canSend}`);
    }
  }
});
