// Where the room screen's window goes (core/room/placement.ts). On the presenter's own display it
// never covers the presenter: it is in a free part of the work area, or under the presenter.
import assert from "node:assert/strict";
import { test } from "node:test";
import { placeRoom, SHARED_MAX_WIDTH, SHARED_MIN_WIDTH } from "../../src/core/room/placement.ts";
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
  assert.deepEqual(placeRoom([LAPTOP, PROJECTOR], 1, PRESENTER, null), { displayId: 2, bounds: PROJECTOR.bounds, fullScreen: true, behindPresenter: false });
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

const ratio = (r: Rect): boolean => Math.abs(r.width / r.height - 16 / 9) < 0.02;
function shared(wa: DisplayFacts, presenter: Rect) {
  const p = placeRoom([wa], wa.id, presenter, null);
  assert.ok(p && !p.fullScreen && p.displayId === wa.id, JSON.stringify(p));
  assert.ok(inside(p.bounds, wa.workArea), `inside the work area: ${JSON.stringify(p.bounds)}`);
  assert.ok(ratio(p.bounds), `16:9: ${JSON.stringify(p.bounds)}`);
  return p;
}

test("one display: a 16:9 window in the largest free part beside the presenter, never over it", () => {
  const p = shared(LAPTOP, PRESENTER);
  assert.equal(p.behindPresenter, false);
  assert.ok(!overlaps(p.bounds, PRESENTER), JSON.stringify(p.bounds));
  // 820 px free on the right: the window takes all of it, at the far edge, level with the presenter.
  assert.deepEqual(p.bounds, { x: 1100, y: 80, width: 820, height: 461 });
  // The presenter on the right half: the room goes to its left.
  const right: Rect = { x: 900, y: 80, width: 1000, height: 790 };
  const q = shared(LAPTOP, right);
  assert.ok(!q.behindPresenter && !overlaps(q.bounds, right) && q.bounds.x === 0, JSON.stringify(q.bounds));
  // Never wider than the maximum, with all the room in the world.
  const wide = shared(TV, { x: -3840, y: 0, width: 1000, height: 760 });
  assert.equal(wide.bounds.width, SHARED_MAX_WIDTH);
  assert.ok(!overlaps(wide.bounds, { x: -3840, y: 0, width: 1000, height: 760 }));
});

test("one display: below or above the presenter where the sides are too narrow", () => {
  // 1280×1024 with the presenter at the top left: 280 px beside it, 304 px below it.
  const square = display(1, 0, 1280, 1024, 0);
  const top: Rect = { x: 0, y: 0, width: 1000, height: 720 };
  const p = shared(square, top);
  assert.equal(p.behindPresenter, false);
  assert.ok(!overlaps(p.bounds, top), JSON.stringify(p.bounds));
  assert.deepEqual(p.bounds, { x: 0, y: 720, width: 540, height: 304 });
  const bottom: Rect = { x: 280, y: 304, width: 1000, height: 720 };
  const q = shared(square, bottom);
  assert.ok(!q.behindPresenter && !overlaps(q.bounds, bottom) && q.bounds.y === 0, JSON.stringify(q.bounds));
});

test("one display with no free part for the minimum: the minimum, under the presenter (the shell raises it)", () => {
  const small = display(1, 0, 1280, 800);
  const p = shared(small, { x: 140, y: 0, width: 1000, height: 760 });
  assert.equal(p.behindPresenter, true);
  assert.deepEqual(p.bounds, { x: 1280 - SHARED_MIN_WIDTH, y: 0, width: SHARED_MIN_WIDTH, height: 270 });
  // A free part just under the minimum is not used: 479 px beside the presenter.
  const edge = display(1, 0, 1479, 1000, 0);
  assert.equal(shared(edge, { x: 0, y: 0, width: 1000, height: 1000 }).behindPresenter, true);
  const fits = display(1, 0, 1480, 1000, 0);
  const f = shared(fits, { x: 0, y: 0, width: 1000, height: 1000 });
  assert.ok(!f.behindPresenter && f.bounds.width === SHARED_MIN_WIDTH, JSON.stringify(f.bounds));
  // Smaller than the minimum: as large as it fits, still 16:9.
  const tiny = display(1, 0, 400, 300, 0);
  const t = shared(tiny, { x: 0, y: 0, width: 400, height: 300 });
  assert.ok(t.behindPresenter && t.bounds.width === 400 && t.bounds.height === 225, JSON.stringify(t.bounds));
});

test("a presenter partly off its display is clipped to the work area", () => {
  const p = shared(LAPTOP, { x: -500, y: -100, width: 1000, height: 790 });
  assert.ok(!p.behindPresenter && !overlaps(p.bounds, { x: -500, y: -100, width: 1000, height: 790 }), JSON.stringify(p.bounds));
  assert.equal(p.bounds.width, SHARED_MAX_WIDTH);
});

test("no display: no placement; no presenter window: any display is free", () => {
  assert.equal(placeRoom([], 1, PRESENTER, null), null);
  assert.equal(placeRoom([LAPTOP], null, null, null)?.fullScreen, true, "no presenter: the one display is free");
});
