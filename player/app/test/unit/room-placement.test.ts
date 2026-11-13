// Where the room screen's window goes (core/room/placement.ts): full screen on another display than
// the presenter's, or, with one display, full screen on it above the presenter (plan section 3,
// "One screen first"; class-list.md, "Where the room window goes").
import assert from "node:assert/strict";
import { test } from "node:test";
import { placeRoom } from "../../src/core/room/placement.ts";
import type { DisplayFacts } from "../../src/core/room/placement.ts";

const display = (id: number, x: number, width: number, height: number, bar = 40): DisplayFacts => ({
  id,
  bounds: { x, y: 0, width, height },
  workArea: { x, y: 0, width, height: height - bar },
});
const LAPTOP = display(1, 0, 1920, 1200);
const PROJECTOR = display(2, 1920, 1920, 1080);
const TV = display(3, -3840, 3840, 2160);

test("another display than the presenter's: full screen on all of it", () => {
  assert.deepEqual(placeRoom([LAPTOP, PROJECTOR], 1, null), { displayId: 2, bounds: PROJECTOR.bounds, fullScreen: true, alone: false });
  // The order the system lists them in does not matter; the presenter's display is never taken.
  assert.deepEqual(placeRoom([PROJECTOR, LAPTOP], 1, null)?.displayId, 2);
  assert.deepEqual(placeRoom([LAPTOP, PROJECTOR], 2, null)?.displayId, 1);
});

test("with two others, the largest; of equals, the first listed", () => {
  assert.equal(placeRoom([LAPTOP, PROJECTOR, TV], 1, null)?.displayId, 3);
  const twin = display(4, 3840, 1920, 1080);
  assert.equal(placeRoom([LAPTOP, PROJECTOR, twin], 1, null)?.displayId, 2);
});

test("the display the room window was last on wins while it is there and is not the presenter's", () => {
  assert.equal(placeRoom([LAPTOP, PROJECTOR, TV], 1, 2)?.displayId, 2);
  // Unplugged: the rule picks again.
  assert.equal(placeRoom([LAPTOP, TV], 1, 2)?.displayId, 3);
  // Now the presenter's own display: another display still comes first.
  assert.equal(placeRoom([LAPTOP, PROJECTOR], 1, 1)?.displayId, 2);
});

test("one display: the room window fills it, full screen, above the presenter (alone)", () => {
  assert.deepEqual(placeRoom([LAPTOP], 1, null), { displayId: 1, bounds: LAPTOP.bounds, fullScreen: true, alone: true });
  // The whole display, not the work area: the class runs from the room screen's own controls.
  assert.deepEqual(placeRoom([LAPTOP], 1, 1)?.bounds, LAPTOP.bounds);
});

test("no display: no placement; no presenter window: the one display is still alone", () => {
  assert.equal(placeRoom([], 1, null), null);
  assert.deepEqual(placeRoom([LAPTOP], null, null), { displayId: 1, bounds: LAPTOP.bounds, fullScreen: true, alone: true });
  assert.equal(placeRoom([LAPTOP, PROJECTOR], null, null)?.alone, false);
});
