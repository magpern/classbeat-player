import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { beatPeriodMs, canShowBeat, cueIsLong, hasThreeTargets } from "../../src/room/fit.ts";
import { cadenceText, classTimeText, clockText, countdownIsWide, countdownText, positionText, rangeText, targetTexts } from "../../src/room/format.ts";
import type { Class } from "../../src/room/input.ts";

describe("format", () => {
  it("clockText: M:SS, H:MM:SS from an hour, whole seconds rounded down", () => {
    assert.equal(clockText(70_000), "1:10");
    assert.equal(clockText(0), "0:00");
    assert.equal(clockText(599_999), "9:59");
    assert.equal(clockText(3_600_000), "1:00:00");
    assert.equal(clockText(7_138_000), "1:58:58");
    assert.equal(clockText(-5), "0:00");
  });

  it("classTimeText: MM:SS, and H:MM:SS from one hour", () => {
    assert.equal(classTimeText(1_421_000), "23:41");
    assert.equal(classTimeText(65_000), "01:05");
    assert.equal(classTimeText(3_955_000), "1:05:55");
  });

  it("countdownText: M:SS below ten minutes, MM:SS to 99:59, 99+ from 100 minutes", () => {
    assert.equal(countdownText(70_000), "1:10");
    assert.equal(countdownText(600_000), "10:00");
    assert.equal(countdownText(3_538_000), "58:58");
    assert.equal(countdownText(5_999_000), "99:59");
    assert.equal(countdownText(6_000_000), "99+");
    assert.equal(countdownText(9_000_000), "99+");
  });

  it("the countdown's size is chosen for the interval's format and stays fixed", () => {
    assert.equal(countdownIsWide(599_000), false);
    assert.equal(countdownIsWide(600_000), true);
    assert.equal(countdownIsWide(1_200_000), true);
  });

  it("ranges use an en dash and targets come in the spec's order", () => {
    assert.equal(rangeText(88, 94), "88–94");
    const def = { zone: 6, name: "x", hrmax_pct: [92, 100], rpe: [9, 10], ftp_pct: [105, 120] } as Class["zone_scale"][number];
    assert.deepEqual(targetTexts(def), ["105–120% FTP", "RPE 9–10", "92–100% HRmax"]);
    assert.deepEqual(targetTexts(undefined), []);
    assert.deepEqual(targetTexts({ zone: 1, name: "x", rpe: [2, 3] }), ["RPE 2–3"]);
  });

  it("cadence and position are words and ranges, never a heart-rate instruction", () => {
    const iv = { start_ms: 0, length_ms: 1, zone: 1, cue: "", cadence: { from: 90, to: 100 }, position: "seated" } as Class["intervals"][number];
    assert.deepEqual(cadenceText(iv), { value: "90–100", unit: "rpm" });
    assert.deepEqual(cadenceText({ ...iv, cadence: "beat" }), { value: "On the beat", unit: null });
    assert.equal(cadenceText({ ...iv, cadence: undefined }), null);
    assert.equal(positionText(iv), "Seated");
    assert.equal(positionText({ ...iv, position: "standing" }), "Standing");
    assert.equal(positionText({ ...iv, position: undefined }), null);
  });
});

describe("fit", () => {
  it("a cue over 60 characters is set smaller", () => {
    assert.equal(cueIsLong("x".repeat(60)), false);
    assert.equal(cueIsLong("x".repeat(61)), true);
  });

  it("three targets are noticed", () => {
    assert.equal(hasThreeTargets(["a", "b"]), false);
    assert.equal(hasThreeTargets(["a", "b", "c"]), true);
  });

  it("nothing flashes more than three times a second at any tempo", () => {
    for (let bpm = 30; bpm <= 300; bpm += 1) {
      const period = beatPeriodMs(bpm);
      assert.ok(1000 / period <= 3 + 1e-9, `${bpm} bpm flashes ${(1000 / period).toFixed(2)} times a second`);
    }
    assert.equal(beatPeriodMs(120), 500); // every beat when that is slow enough
    assert.ok(Math.abs(beatPeriodMs(180) - 1000 / 3) < 1e-9); // every beat up to 180 bpm, exactly 1/3 s
    assert.ok(Math.abs(beatPeriodMs(181) - 60_000 / 181 * 2) < 1e-9); // every second beat above it
    assert.equal(beatPeriodMs(200), 600); // every second beat when it would be too fast
  });

  it("the beat dot needs anchors and a tempo", () => {
    assert.equal(canShowBeat(120, true), true);
    assert.equal(canShowBeat(120, false), false);
    assert.equal(canShowBeat(null, true), false);
    assert.equal(canShowBeat(0, true), false);
  });
});
