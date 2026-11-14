// effort_calc's table tests (docs/design/rider.md, "The effort"; ADR 0007 section 6): watts and
// beats from the rider's own numbers, percentages without them, equal ends once, halves up, a row
// only for a range the zone has, and the hint only while a percentage stands in for a number.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HINT, NO_NUMBERS, effortFor, percentOf, rangeWords } from "../../src/rider/core/effort-calc.ts";
import type { MyNumbers, Range, ZoneEffort } from "../../src/rider/core/effort-calc.ts";

const Z4: ZoneEffort = { ftpPct: [88, 94], hrmaxPct: [85, 92], rpe: [7, 8] };
const ANNA: MyNumbers = { ftp: 250, hrmax: 185 };

type Row = readonly [label: string, value: string, unit: string];
const rows = (z: ZoneEffort, m: MyNumbers): Row[] => effortFor(z, m).rows.map((r) => [r.label, r.value, r.unit] as const);

describe("effort_calc", () => {
  it("percentOf rounds halves up, in whole numbers, with no float error", () => {
    const table: readonly (readonly [number, number, number])[] = [
      [250, 88, 220],
      [250, 94, 235],
      [185, 85, 157], // 157.25
      [185, 92, 170], // 170.2
      [150, 85, 128], // 127.5: half up
      [230, 85, 196], // 195.5: half up
      [201, 50, 101], // 100.5: half up
      [199, 50, 100], // 99.5: half up
      [600, 150, 900],
      [50, 0, 0],
      [80, 100, 80],
      [333, 33, 110], // 109.89
    ];
    for (const [base, pct, want] of table) assert.equal(percentOf(base, pct), want, `${base} x ${pct}%`);
  });

  it("rangeWords writes equal ends once and an en dash otherwise", () => {
    assert.equal(rangeWords(7, 8), "7–8");
    assert.equal(rangeWords(10, 10), "10");
    assert.equal(rangeWords(0, 0), "0");
  });

  it("the spec's rows: FTP 250 at 88 to 94 % and maximum heart rate 185 at 85 to 92 %", () => {
    assert.deepEqual(rows(Z4, ANNA), [
      ["Power", "220–235", "W"],
      ["Heart rate", "157–170", "bpm"],
      ["RPE", "7–8", ""],
    ]);
    assert.equal(effortFor(Z4, ANNA).hint, false);
  });

  it("without the numbers: the percentages, the RPE as it is, and the hint", () => {
    const e = effortFor(Z4, NO_NUMBERS);
    assert.deepEqual(rows(Z4, NO_NUMBERS), [
      ["Power", "88–94%", "FTP"],
      ["Heart rate", "85–92%", "max"],
      ["RPE", "7–8", ""],
    ]);
    assert.equal(e.hint, true);
    assert.equal(HINT, "Add your FTP and max heart rate in My numbers to see watts and beats.");
  });

  it("one number given: that row in its unit, the other as a percentage, and the hint", () => {
    assert.deepEqual(rows(Z4, { ftp: 250, hrmax: null }), [
      ["Power", "220–235", "W"],
      ["Heart rate", "85–92%", "max"],
      ["RPE", "7–8", ""],
    ]);
    assert.equal(effortFor(Z4, { ftp: 250, hrmax: null }).hint, true);
    assert.deepEqual(rows(Z4, { ftp: null, hrmax: 185 }), [
      ["Power", "88–94%", "FTP"],
      ["Heart rate", "157–170", "bpm"],
      ["RPE", "7–8", ""],
    ]);
  });

  it("a range the zone does not have gives no row, and no hint when no percentage is shown", () => {
    const rpeOnly: ZoneEffort = { ftpPct: null, hrmaxPct: null, rpe: [9, 10] };
    assert.deepEqual(rows(rpeOnly, NO_NUMBERS), [["RPE", "9–10", ""]]);
    assert.equal(effortFor(rpeOnly, NO_NUMBERS).hint, false);
    const none: ZoneEffort = { ftpPct: null, hrmaxPct: null, rpe: null };
    assert.deepEqual(effortFor(none, ANNA), { rows: [], hint: false });
    const powerOnly: ZoneEffort = { ftpPct: [56, 75], hrmaxPct: null, rpe: null };
    assert.deepEqual(rows(powerOnly, { ftp: null, hrmax: 185 }), [["Power", "56–75%", "FTP"]]);
    assert.equal(effortFor(powerOnly, { ftp: 250, hrmax: null }).hint, false);
  });

  it("the worst cases fit the spec's widest values", () => {
    const z7: ZoneEffort = { ftpPct: [112, 150], hrmaxPct: [80, 100], rpe: [10, 10] };
    assert.deepEqual(rows(z7, { ftp: 600, hrmax: 230 }), [
      ["Power", "672–900", "W"],
      ["Heart rate", "184–230", "bpm"],
      ["RPE", "10", ""],
    ]);
  });

  it("equal ends are written once in every unit", () => {
    const same: ZoneEffort = { ftpPct: [100, 100], hrmaxPct: [90, 90], rpe: [5, 5] };
    assert.deepEqual(rows(same, ANNA), [
      ["Power", "250", "W"],
      ["Heart rate", "167", "bpm"],
      ["RPE", "5", ""],
    ]);
    assert.deepEqual(rows(same, NO_NUMBERS), [
      ["Power", "100%", "FTP"],
      ["Heart rate", "90%", "max"],
      ["RPE", "5", ""],
    ]);
  });

  it("never writes advice or a measured value: only the range's numbers and the units", () => {
    const ranges: Range[] = [[0, 0], [50, 75], [88, 94], [100, 150]];
    for (const r of ranges) {
      for (const m of [ANNA, NO_NUMBERS]) {
        for (const row of effortFor({ ftpPct: r, hrmaxPct: r, rpe: [1, 10] }, m).rows) {
          assert.match(row.value, /^\d+(–\d+)?%?$/);
          assert.ok(["W", "bpm", "FTP", "max", ""].includes(row.unit));
        }
      }
    }
  });
});
