// How the band, the sheet and the plate book their frames (renderer/room-marks.ts): every one through the room
// screen's mark ledger (`requestMark`, #609), which owns the placement and its tests (web/test/unit/mark-ledger.test.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMarks } from "../../src/renderer/room-marks.ts";
import type { MarkTicket } from "../../src/renderer/room-marks.ts";

/** A stand-in for `screen.requestMark`: a free frame draws at once, a busy one keeps the draw until `flush`. */
function ledger(free = true) {
  const asked: (() => void)[] = [];
  const cancelled: number[] = [];
  const state = { free };
  const requestMark = (draw: () => void): MarkTicket => {
    const i = asked.length;
    asked.push(draw);
    if (state.free) draw();
    return { atMs: 0, cancel: () => void cancelled.push(i) };
  };
  return { requestMark, asked, cancelled, state };
}

test("a request is one mark in the ledger, and its draw runs when the ledger says", () => {
  const l = ledger(false);
  const marks = createMarks(l.requestMark);
  let drew = 0;
  marks.request("band", () => drew++);
  assert.equal(l.asked.length, 1);
  assert.equal(drew, 0, "the player never draws before its mark");
  l.asked[0]!();
  assert.equal(drew, 1);
});

test("a free frame draws inside the request", () => {
  const l = ledger(true);
  const marks = createMarks(l.requestMark);
  let drew = 0;
  marks.request("band", () => drew++);
  assert.equal(drew, 1);
  marks.request("band", () => drew++);
  assert.equal(l.asked.length, 2, "once drawn, the next change is a new mark");
});

test("a second request under a waiting key books no second mark", () => {
  const l = ledger(false);
  const marks = createMarks(l.requestMark);
  marks.request("sheet", () => undefined);
  marks.request("sheet", () => undefined);
  marks.request("plate", () => undefined);
  assert.equal(l.asked.length, 2);
});

test("cancel gives the waiting mark back to the ledger", () => {
  const l = ledger(false);
  const marks = createMarks(l.requestMark);
  marks.request("band", () => undefined);
  marks.cancel("band");
  assert.deepEqual(l.cancelled, [0]);
  marks.cancel("band");
  assert.deepEqual(l.cancelled, [0], "nothing waiting, nothing to give back");
  marks.request("band", () => undefined);
  assert.equal(l.asked.length, 2);
});
