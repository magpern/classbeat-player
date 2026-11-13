// Where the room screen's window goes, and when it closes (core/room/placement.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { placeRoom, roomCloses, SHARED_MAX_WIDTH, SHARED_MIN_WIDTH } from "../../src/core/room/placement.ts";
import type { DisplayFacts, Rect } from "../../src/core/room/placement.ts";

const display = (id: number, x: number, width: number, height: number, bar = 40): DisplayFacts => ({
  id,
  bounds: { x, y: 0, width, height },
  workArea: { x, y: 0, width, height: height - bar },
});
const LAPTOP = display(1, 0, 1920, 1200);
const PROJECTOR = display(2, 1920, 1920, 1080);
const TV = display(3, -3840, 3840, 2160);
const PRESENTER: Rect = { x: 100, y: 80, width: 1000, height: 790 };

const inside = (r: Rect, outer: Rect): boolean => r.x >= outer.x && r.y >= outer.y && r.x + r.width <= outer.x + outer.width && r.y + r.height <= outer.y + outer.height;
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("another display than the presenter's: full screen on all of it", () => {
  assert.deepEqual(placeRoom([LAPTOP, PROJECTOR], 1, PRESENTER, null), { displayId: 2, bounds: PROJECTOR.bounds, fullScreen: true });
  // The order the system lists them in does not matter; the presenter's display is never taken.
  assert.deepEqual(placeRoom([PROJECTOR, LAPTOP], 1, PRESENTER, null)?.displayId, 2);
  assert.deepEqual(placeRoom([LAPTOP, PROJECTOR], 2, PRESENTER, null)?.displayId, 1);
});

test("with two others, the largest; of equals, the first listed", () => {
  assert.equal(placeRoom([LAPTOP, PROJECTOR, TV], 1, PRESENTER, null)?.displayId, 3);
  const twin = display(4, 3840, 1920, 1080);
  assert.equal(placeRoom([LAPTOP, PROJECTOR, twin], 1, PRESENTER, null)?.displayId, 2);
});

test("the display the room window was last on wins while it is there and is not the presenter's", () => {
  assert.equal(placeRoom([LAPTOP, PROJECTOR, TV], 1, PRESENTER, 2)?.displayId, 2);
  // Unplugged: the rule picks again.
  assert.equal(placeRoom([LAPTOP, TV], 1, PRESENTER, 2)?.displayId, 3);
  // Now the presenter's own display: another display still comes first.
  assert.equal(placeRoom([LAPTOP, PROJECTOR], 1, PRESENTER, 1)?.displayId, 2);
});

test("one display: a 16:9 window beside the presenter, inside the work area, not full screen", () => {
  const p = placeRoom([LAPTOP], 1, PRESENTER, null);
  assert.ok(p);
  assert.equal(p.fullScreen, false);
  assert.equal(p.displayId, 1);
  assert.ok(inside(p.bounds, LAPTOP.workArea), JSON.stringify(p.bounds));
  assert.ok(!overlaps(p.bounds, PRESENTER), JSON.stringify(p.bounds));
  assert.ok(Math.abs(p.bounds.width / p.bounds.height - 16 / 9) < 0.01);
  assert.ok(p.bounds.width >= SHARED_MIN_WIDTH && p.bounds.width <= SHARED_MAX_WIDTH);
  // The presenter on the right half: the room goes to its left.
  const right: Rect = { x: 900, y: 80, width: 1000, height: 790 };
  const q = placeRoom([LAPTOP], 1, right, null);
  assert.ok(q && inside(q.bounds, LAPTOP.workArea) && !overlaps(q.bounds, right) && q.bounds.x === 0, JSON.stringify(q?.bounds));
});

test("one display too small to keep them apart: the minimum size, inside the work area", () => {
  const small = display(1, 0, 1280, 800);
  const p = placeRoom([small], 1, { x: 140, y: 0, width: 1000, height: 760 }, null);
  assert.ok(p && !p.fullScreen && inside(p.bounds, small.workArea), JSON.stringify(p?.bounds));
  assert.equal(p.bounds.width, SHARED_MIN_WIDTH);
  // Smaller than the minimum: as large as it fits, still 16:9.
  const tiny = display(1, 0, 600, 400);
  const t = placeRoom([tiny], 1, null, null);
  assert.ok(t && inside(t.bounds, tiny.workArea), JSON.stringify(t?.bounds));
});

test("no display: no placement; no presenter window: any display is free", () => {
  assert.equal(placeRoom([], 1, PRESENTER, null), null);
  assert.equal(placeRoom([LAPTOP], null, null, null)?.fullScreen, true, "no presenter: the one display is free");
});

test("the room window closes on the class list once no class is pinned, and only then", () => {
  assert.equal(roomCloses(true, false), true);
  assert.equal(roomCloses(true, true), false, "Back to the class is still offered");
  assert.equal(roomCloses(false, false), false, "the presenter shows the class, ended or not");
  assert.equal(roomCloses(false, true), false);
});
