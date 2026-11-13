// When the band shows and hides (core/room/band-model.ts; room-2d.md, "When it shows and when it
// hides"; check C10's behaviour list, here in the pure model; test/shots/room-band-behaviour runs it
// on the real page).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as M from "../../src/core/room/band-model.ts";
import type { BandContext, BandState } from "../../src/core/room/band-model.ts";

const FREE: BandContext = { pinned: false, fadeMs: M.FADE_MS };
const STILL: BandContext = { pinned: false, fadeMs: 0 };
const PINNED: BandContext = { pinned: true, fadeMs: M.FADE_MS };
const shownAt = (t: number): BandState => M.reveal(M.HIDDEN, t);
const at = (s: BandState, t: number, ctx = FREE): BandState => M.tick(s, t, ctx);

test("it hides 3 s after the last input, then fades out over --m-state", () => {
  const s = shownAt(1000);
  assert.equal(at(s, 3999).phase, "shown");
  const fading = at(s, 4000);
  assert.equal(fading.phase, "fading");
  assert.equal(M.nextChangeAt(fading, FREE), 4300);
  assert.equal(at(fading, 4300).phase, "hidden");
});

test("with reduced motion it hides in 0 ms", () => {
  assert.equal(at(shownAt(0), 3000, STILL).phase, "hidden");
});

test("a pointer move shows it only past 6 px; a nudge does not", () => {
  let s = M.pointerMove(M.HIDDEN, 100, 100, 0);
  assert.equal(s.phase, "hidden");
  s = M.pointerMove(s, 103, 104, 10);
  assert.equal(s.phase, "hidden");
  s = M.pointerMove(s, 106, 100, 20);
  assert.equal(s.phase, "shown");
  assert.equal(s.lastInputAt, 20);
});

test("each kind of input restarts the 3 s; a key that does something else never shows it", () => {
  let s = shownAt(0);
  s = M.keyPress(s, 2000);
  assert.equal(at(s, 4999).phase, "shown");
  s = M.press(s, 4000, FREE).state;
  assert.equal(at(s, 6999).phase, "shown");
  s = M.pointerMove(M.pointerMove(s, 0, 0, 6000), 50, 0, 6500);
  assert.equal(at(s, 9499).phase, "shown");
  assert.equal(at(s, 9500).phase, "fading");
  assert.equal(M.keyPress(M.HIDDEN, 10).phase, "hidden");
});

test("a click or tap while hidden or fading presses nothing and only shows it", () => {
  const hidden = M.press(M.HIDDEN, 0, FREE);
  assert.equal(hidden.pressed, false);
  assert.equal(hidden.state.phase, "shown");
  const fading = at(shownAt(0), 3000);
  const r = M.press(fading, 3100, FREE);
  assert.equal(r.pressed, false);
  assert.equal(r.state.phase, "shown");
  assert.equal(M.press(shownAt(0), 100, FREE).pressed, true);
});

test("after a press it still hides 3 s later; a press drops keyboard focus", () => {
  let s = M.tabFocus(shownAt(0), true, 0);
  s = M.press(s, 1000, FREE).state;
  assert.equal(s.tabFocus, false);
  assert.equal(at(s, 4000).phase, "fading");
});

test("keyboard focus reached by Tab holds it until Esc", () => {
  let s = M.tabFocus(shownAt(0), true, 0);
  assert.equal(at(s, 60_000).phase, "shown");
  assert.equal(M.nextChangeAt(s, FREE), null);
  s = M.escape(s, 60_000, FREE);
  assert.equal(s.phase, "fading");
  assert.equal(s.tabFocus, false);
  assert.equal(M.escape(shownAt(0), 0, STILL).phase, "hidden");
});

test("the End question holds it until answered; then the 3 s start again", () => {
  let s = M.asking(M.HIDDEN, true, 0);
  assert.equal(s.phase, "shown");
  assert.equal(at(s, 60_000).phase, "shown");
  s = M.asking(s, false, 60_000);
  assert.equal(at(s, 62_999).phase, "shown");
  assert.equal(at(s, 63_000).phase, "fading");
});

test("with one display it stays before the start and on Class Complete; never with two", () => {
  assert.equal(M.isPinned(true, "ready"), true);
  assert.equal(M.isPinned(true, "ended"), true);
  assert.equal(M.isPinned(true, "running"), false);
  assert.equal(M.isPinned(true, "paused"), false);
  assert.equal(M.isPinned(false, "ready"), false);
  assert.equal(M.isPinned(false, "ended"), false);
  const s = at(M.HIDDEN, 0, PINNED);
  assert.equal(s.phase, "shown");
  assert.equal(at(s, 600_000, PINNED).phase, "shown");
  assert.equal(M.nextChangeAt(s, PINNED), null);
  assert.equal(M.escape(s, 10, PINNED).phase, "shown");
  assert.equal(M.press(s, 10, PINNED).pressed, true);
});
