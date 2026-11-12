// The link inside the shell's state: commands from the presenter, readings through advance(), the
// snapshot's link view, and the controller with a scripted reader.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseClockCommand } from "../../src/core/commands.ts";
import { createClock, positionAt } from "../../src/core/clock/index.ts";
import { createScriptedReader, initialLink, undo } from "../../src/core/link/index.ts";
import type { Observation } from "../../src/core/link/index.ts";
import { advance, command, INITIAL, openText, snapshotOf } from "../../src/core/player-state.ts";
import { classSchema, converterExamples } from "./fixtures.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";

const text = readFileSync(converterExamples()[0], "utf8");
const doc = JSON.parse(text) as Class;
const first = doc.songs[0];
const reading = (at: number, positionMs: number): Observation => ({ title: first.title, artist: first.artist, lengthMs: first.length_ms, positionMs, playing: true, at, seenAt: at });

test("commands: the link's controls pass the shape check, anything else is refused", () => {
  for (const type of ["undo", "manual", "follow"]) assert.deepEqual(parseClockCommand({ type }), { type });
  assert.deepEqual(parseClockCommand({ type: "pick", songIndex: 3 }), { type: "pick", songIndex: 3 });
  for (const bad of [{ type: "undo", extra: 1 }, { type: "pick" }, { type: "pick", songIndex: -1 }, { type: "pick", songIndex: 1.5 }, { type: "pick", songIndex: 1000 }, { type: "pick", songIndex: "1" }, { type: "pick", songIndex: 1, x: 1 }]) {
    assert.equal(parseClockCommand(bad), null, JSON.stringify(bad));
  }
});

test("with no reader the clock is manual only: readings are ignored and nothing can be followed", () => {
  let s = openText(INITIAL, "a.json", text, classSchema, 0);
  s = advance(s, 1000, reading(1000, 0));
  const snap = snapshotOf(s, 1000);
  assert.equal(snap.link?.state, "Manual");
  assert.equal(snap.link?.available, false);
  assert.equal(snap.view?.status, "ready");
  assert.equal(snapshotOf(command(s, { type: "follow" }, 1000), 1000).link?.mode, "manual");
});

test("with a reader the clock follows the music through advance(), and the presenter sees the state", () => {
  let s = openText(INITIAL, "a.json", text, classSchema, 0, true);
  assert.equal(snapshotOf(s, 0).link?.available, true);
  s = advance(s, 1000, reading(1000, 5000));
  const snap = snapshotOf(s, 3000);
  assert.equal(snap.link?.state, "Locked");
  assert.equal(snap.view?.classMs, first.start_ms + 7000);
  assert.equal(snap.link?.songIndex, 0);
});

test("the manual-clock and follow commands move the link between its modes", () => {
  let s = openText(INITIAL, "a.json", text, classSchema, 0, true);
  s = advance(s, 1000, reading(1000, 5000));
  s = command(s, { type: "manual" }, 1500);
  assert.equal(snapshotOf(s, 1500).link?.state, "Manual");
  s = advance(s, 2000, reading(2000, 6000));
  assert.equal(snapshotOf(s, 2000).link?.state, "Manual", "readings no longer move the clock");
  s = command(s, { type: "follow" }, 2500);
  s = advance(s, 2600, reading(2600, 6600));
  assert.equal(snapshotOf(s, 2600).link?.state, "Locked");
});

test("a far resync shows its announcement and the undo command takes it back", () => {
  let s = openText(INITIAL, "a.json", text, classSchema, 0, true);
  s = advance(s, 1000, reading(1000, 5000));
  s = command(s, { type: "manual" }, 1100);
  s = command(s, { type: "start" }, 1100);
  s = command(s, { type: "jump", deltaMs: 5000 }, 1100);
  s = command(s, { type: "follow" }, 1200);
  s = advance(s, 20_000, reading(20_000, 100_000));
  const snap = snapshotOf(s, 20_000);
  assert.match(snap.link?.announcement ?? "", /^resynced, \d+ s (forward|back)$/);
  assert.equal(snap.link?.canUndo, true);
  s = command(s, { type: "undo" }, 21_000);
  assert.equal(snapshotOf(s, 21_000).link?.state, "Manual");
  assert.equal(snapshotOf(s, 21_000).link?.canUndo, false);
});

test("the scripted reader delivers what the music app does, as a real reader would", () => {
  const r = createScriptedReader([
    { from: 0, track: { title: "T", artist: "A" }, positionMs: 1000, playing: true },
    { from: 10_000, track: { title: "T", artist: "A" }, positionMs: 11_000, playing: false, delivering: false },
    { from: 20_000, track: null, positionMs: 0, playing: false },
  ]);
  assert.equal(r.kind, "fake");
  assert.deepEqual(r.latest(5000), { title: "T", artist: "A", app: null, positionMs: 6000, playing: true, at: 5000, seenAt: 5000 });
  assert.equal(r.latest(12_000)?.seenAt, 5000, "quiet: the old reading, ageing");
  assert.equal(r.latest(25_000), null, "closed");
});

test("undo: available until its time is over, then refused and nothing changes", () => {
  const clock = createClock(600_000, 0);
  const link = { ...initialLink(true), state: "Locked" as const, undo: { clockMs: 5000, at: 0, until: 100 } };
  const late = undo(link, clock, 101);
  assert.equal(late.event, "undo_unavailable");
  assert.equal(late.clock, clock);
  assert.equal(late.link.mode, "following");
  const ok = undo(link, clock, 100);
  assert.equal(ok.event, "undo");
  assert.equal(ok.link.mode, "manual");
  assert.equal(positionAt(ok.clock, 100), 5100, "where it would have run to since the resync (at 0)");
});
