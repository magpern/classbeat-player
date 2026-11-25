// fitPlate (renderer/mix-paint.ts): a Swedebeat plate's detail goes to one line when fewer than five
// whole rows fit beside the filter (#724). Fakes stand in for the page: rows fit by the list's
// height and a row's, never by what is scrolled into view.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitPlate, KEEP_ROWS } from "../../src/renderer/mix-paint.ts";

const LONG = "Check the connection, then try again. Swedebeat classes play on the manual clock.";
const SHORT = "Check the connection, then try again.";

function rig(rowCount: number) {
  const dt = { textContent: LONG as string | null };
  const dataset: Record<string, string | undefined> = { short: SHORT };
  const slot = { querySelector: (s: string) => (s === ".plate[data-short]" ? { dataset, querySelector: () => dt } : null) };
  const list = { clientHeight: 0, scrollTop: 0, querySelectorAll: () => Array.from({ length: rowCount }, () => ({ offsetHeight: 65 })) };
  return { dt, slot, list };
}

test("five or more rows fit: the long detail stays; fewer fit: the short one shows", () => {
  const r = rig(12);
  r.list.clientHeight = 5 * 65;
  fitPlate(r.slot, r.list);
  assert.equal(r.dt.textContent, LONG);
  r.list.clientHeight = 5 * 65 - 1;
  fitPlate(r.slot, r.list);
  assert.equal(r.dt.textContent, SHORT);
});

test("a scrolled list changes nothing: the room is the list's height, not the rows in view (#724)", () => {
  const r = rig(12);
  r.list.clientHeight = 5 * 65 + 30;
  r.list.scrollTop = 30;
  fitPlate(r.slot, r.list);
  assert.equal(r.dt.textContent, LONG);
});

test("a resize gives the long detail back and takes it away again", () => {
  const r = rig(12);
  r.list.clientHeight = 4 * 65;
  fitPlate(r.slot, r.list);
  assert.equal(r.dt.textContent, SHORT);
  r.list.clientHeight = 8 * 65;
  fitPlate(r.slot, r.list);
  assert.equal(r.dt.textContent, LONG);
  r.list.clientHeight = 3 * 65;
  fitPlate(r.slot, r.list);
  assert.equal(r.dt.textContent, SHORT);
});

test("fewer rows than the floor never cut the detail when they all fit", () => {
  const r = rig(3);
  r.list.clientHeight = 3 * 65;
  fitPlate(r.slot, r.list);
  assert.equal(r.dt.textContent, LONG);
  assert.equal(KEEP_ROWS, 5);
});
