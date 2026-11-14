// When the room screen's join sheet shows (core/room/join-sheet.ts; room-join.md): by itself before
// the start and closed at once at the start, J for at most 20 s during the class, Esc closes it, no
// code no sheet, and the "New code" plate for 10 s when the code changes while it is open. With the
// band's slot while the sheet is open (band-view.ts): no QR code, "J hides the codes". Pure.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bandView, SHEET_LINE } from "../../src/core/room/band-view.ts";
import type { ClockStatus } from "../../src/core/room/band-view.ts";
import { NO_SHEET, PLATE_MS, plateShown, SHEET_RUNNING_MS, sheetEscape, sheetFacts, sheetJoin, sheetTick, sheetWakeAt } from "../../src/core/room/join-sheet.ts";
import type { JoinSheet } from "../../src/core/room/join-sheet.ts";

const CODE = "KXPD-RMTB";
const at = (s: JoinSheet, status: ClockStatus | null, code: string | null = CODE, now = 0): JoinSheet => sheetFacts(s, { status, code }, now);

test("before the start, with a code, the sheet opens by itself and closes at once at the start", () => {
  const s = at(NO_SHEET, "ready");
  assert.equal(s.open, true);
  assert.equal(s.until, null);
  assert.equal(at(s, "ready").open, true);
  assert.equal(at(s, "running").open, false);
  // A class that opens running (a resumed run) never shows it by itself.
  assert.equal(at(NO_SHEET, "running").open, false);
});

test("before the start J toggles it; closed by J or Esc it stays closed until J again", () => {
  const s = at(NO_SHEET, "ready");
  const closed = sheetJoin(s, 0);
  assert.deepEqual([closed.taken, closed.sheet.open], [true, false]);
  assert.equal(at(closed.sheet, "ready").open, false);
  assert.equal(sheetJoin(closed.sheet, 0).sheet.open, true);
  const esc = sheetEscape(s);
  assert.deepEqual([esc.taken, esc.sheet.open, at(esc.sheet, "ready").open], [true, false, false]);
  assert.equal(sheetEscape(esc.sheet).taken, false);
});

test("during the class J opens it for at most 20 s; J or Esc closes it sooner", () => {
  const s = at(at(NO_SHEET, "ready"), "running");
  const j = sheetJoin(s, 1000);
  assert.deepEqual([j.taken, j.sheet.open, j.sheet.until], [true, true, 1000 + SHEET_RUNNING_MS]);
  assert.equal(sheetWakeAt(j.sheet), 1000 + SHEET_RUNNING_MS);
  assert.equal(sheetTick(j.sheet, 1000 + SHEET_RUNNING_MS - 1).open, true);
  assert.equal(sheetTick(j.sheet, 1000 + SHEET_RUNNING_MS).open, false);
  assert.equal(sheetJoin(j.sheet, 2000).sheet.open, false);
  assert.equal(sheetEscape(j.sheet).sheet.open, false);
  // A pause keeps it open; the clock goes on underneath.
  assert.equal(at(j.sheet, "paused").open, true);
});

test("no code, or the class ended: no sheet, and J does nothing", () => {
  for (const [status, code] of [["ready", null], ["running", null], ["ended", CODE], [null, CODE]] as const) {
    const s = at(NO_SHEET, status, code);
    assert.equal(s.open, false, `${status} ${code}`);
    const j = sheetJoin(s, 0);
    assert.deepEqual([j.taken, j.sheet.open], [false, false]);
  }
  // The code going (join codes off) closes an open sheet.
  assert.equal(at(at(NO_SHEET, "ready"), "ready", null).open, false);
});

test("a new code while the sheet is open shows the plate for 10 s; a new code never opens it", () => {
  const s = at(NO_SHEET, "ready", CODE, 0);
  const n = at(s, "ready", "BCDF-GHJK", 500);
  assert.equal(n.code, "BCDF-GHJK");
  assert.equal(plateShown(n, 500), true);
  assert.equal(sheetWakeAt(n), 500 + PLATE_MS);
  assert.equal(plateShown(sheetTick(n, 500 + PLATE_MS), 500 + PLATE_MS), false);
  // During the class, closed: the code changes and nothing shows.
  const running = at(s, "running", CODE, 1000);
  const changed = at(running, "running", "BCDF-GHJK", 2000);
  assert.deepEqual([changed.open, changed.plateUntil, changed.code], [false, null, "BCDF-GHJK"]);
  // The next time it opens, it is the new code, without the plate.
  const j = sheetJoin(changed, 3000).sheet;
  assert.deepEqual([j.open, j.code, plateShown(j, 3000)], [true, "BCDF-GHJK", false]);
});

test("while the sheet is open the band's slot has no QR code and says J hides the codes", () => {
  const on = { slot: "on", joinCode: CODE, phones: 0, reconnecting: false, site: "https://classbeat.example" } as const;
  const shut = bandView("ready", null, on, false, false);
  const open = bandView("ready", null, on, false, true);
  assert.ok(shut.mode === "buttons" && open.mode === "buttons");
  assert.deepEqual(shut.code, { code: CODE, line: "Phone remote on", address: `https://classbeat.example/j#${CODE}` });
  assert.deepEqual(open.code, { code: CODE, line: SHEET_LINE, address: null });
  assert.ok(SHEET_LINE.length <= 18);
});

test("the sheet holds the join code and the clock's state only", () => {
  const s = at(NO_SHEET, "ready");
  assert.deepEqual(Object.keys(s).sort(), ["code", "dismissed", "open", "plateUntil", "status", "until"]);
});
