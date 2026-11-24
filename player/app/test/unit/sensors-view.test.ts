// The instructor's sensor panel, pure part (#664; docs/design/sensors.md part 2; ADR 0012 section 4).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Interval, ZoneDef } from "../../../../schema/generated/ts/class.d.ts";
import { gauge, gaugeTrack } from "../../src/core/sensors/gauge-calc.ts";
import { numbersFrom, NO_NUMBERS, planFor } from "../../src/core/sensors/plan.ts";
import { NONE, step } from "../../src/core/sensors/shown.ts";
import { failedLine, LABEL, measuresWords, planLine, SERVICE_WORDS, TEXT } from "../../src/core/sensors/strings.ts";
import { UNAVAILABLE_SOURCE } from "../../src/core/sensors/unavailable-source.ts";
import { buildView, freshValues } from "../../src/core/sensors/view.ts";
import type { PlanInput } from "../../src/core/sensors/view.ts";
import { ZONE_HUES } from "../../src/core/sensors/zone-hue.ts";
import { FakeSensorSource } from "./fake-sensor-source.ts";
import { REPO } from "./fixtures.ts";

const IV = (cadence: Interval["cadence"]): Interval => ({ start_ms: 0, length_ms: 60000, zone: 4, cadence, cue: "x" }) as Interval;
const ZONE: ZoneDef = { zone: 4, name: "Threshold", ftp_pct: [95, 105], hrmax_pct: [85, 92] };
const PLAN = (cadence: Interval["cadence"] = { from: 90, to: 100 }): PlanInput => ({ interval: IV(cadence), zone: ZONE });
const N = numbersFrom(250, 185);
const rows = (s: FakeSensorSource, shown: ReturnType<typeof freshValues>, p = PLAN(), n = N) => buildView(s.snapshot(), shown, p, n);

describe("gauge_calc", () => {
  it("the track and band of the spec's heart-rate example (157 to 170: the band is 20.3 % of the track)", () => {
    assert.deepEqual(gaugeTrack([157, 170]), [131.5, 195.5]);
    const g = gauge([157, 170], null);
    assert.ok(Math.abs((g.band[1] - g.band[0]) - 0.203) < 0.001);
    assert.equal(g.tick, null);
  });
  it("a plan at least 15 % of its top wide gets a band of a third of the track", () => {
    const g = gauge([90, 120], null);
    assert.ok(Math.abs(g.band[1] - g.band[0] - 1 / 3) < 1e-9);
  });
  it("the mock-ups' cadence 90 to 100 and the worst case 100 to 110", () => {
    assert.deepEqual(gaugeTrack([90, 100]), [75, 115]);
    assert.deepEqual(gaugeTrack([100, 110]), [83.5, 126.5]);
    assert.equal(gauge([90, 100], 95).tick, 0.5);
  });
  it("the tick is clamped to the ends of the track", () => {
    assert.equal(gauge([90, 100], 0).tick, 0);
    assert.equal(gauge([90, 100], 250).tick, 1);
  });
  it("the tick's place is the same whatever the plan means: no state, only a place", () => {
    for (const v of [60, 89, 90, 95, 100, 101, 140]) assert.deepEqual(Object.keys(gauge([90, 100], v)).sort(), ["band", "tick", "track"]);
  });
});

describe("the plan each reading is set against", () => {
  it("heart rate and power need the person's number; without it the plan is a percentage and there is no gauge", () => {
    assert.deepEqual(planFor("heartRate", IV(undefined), ZONE, N).range, [157, 170]);
    assert.deepEqual(planFor("power", IV(undefined), ZONE, N).range, [238, 263]);
    const p = planFor("heartRate", IV(undefined), ZONE, NO_NUMBERS);
    assert.equal(p.range, null);
    assert.equal(p.text, "85–92 % of max");
    assert.equal(p.needsNumber, true);
  });
  it("cadence is gauged against the class file's target with no number from the person", () => {
    assert.deepEqual(planFor("cadence", IV({ from: 90, to: 100 }), ZONE, NO_NUMBERS).range, [90, 100]);
    assert.equal(planFor("cadence", IV("beat"), ZONE, NO_NUMBERS).range, null);
    assert.equal(planFor("cadence", IV("beat"), ZONE, NO_NUMBERS).text, "on the beat");
    assert.equal(planFor("cadence", IV(undefined), ZONE, NO_NUMBERS).text, null);
    assert.equal(planFor("cadence", null, null, N).text, null);
  });
  it("the two numbers are whole numbers in their ranges, else not a number", () => {
    assert.deepEqual(numbersFrom(49, 79), NO_NUMBERS);
    assert.deepEqual(numbersFrom(601, 231), NO_NUMBERS);
    assert.deepEqual(numbersFrom(250.5, "185"), NO_NUMBERS);
    assert.deepEqual(numbersFrom(50, 230), { ftp: 50, hrmax: 230 });
  });
});

describe("the panel's view", () => {
  const T = 10_000;
  const bike = (): FakeSensorSource => new FakeSensorSource().add("h", "Polar H10", ["heartRate"], { heartRate: { value: 142, at: T } }).add("b", "Bike", ["power", "cadence"], { power: { value: 238, at: T }, cadence: { value: 92, at: T } });

  it("shows heart rate, power and cadence in that order, each with a gauge against its plan", () => {
    const s = bike();
    const v = rows(s, freshValues(s.snapshot(), T));
    assert.deepEqual(v.measures.map((m) => [m.measure, m.value, m.plan, m.gauge !== null]), [
      ["heartRate", 142, "Plan 157–170 bpm", true],
      ["power", 238, "Plan 238–263 W", true],
      ["cadence", 92, "Plan 90–100 rpm", true],
    ]);
    assert.equal(v.measures[0]!.alt, "Heart rate 142 bpm, plan 157 to 170");
    assert.equal(v.state, TEXT.connected);
    assert.equal(v.noNumbers, null);
  });
  it("a reading older than 3 s is a dash, never the last number", () => {
    const s = bike();
    assert.equal(freshValues(s.snapshot(), T + 3000).heartRate, 142);
    const v = rows(s, freshValues(s.snapshot(), T + 3001));
    assert.deepEqual(v.measures.map((m) => m.value), [null, null, null]);
    assert.ok(v.measures.every((m) => m.gauge?.tick === null));
    assert.equal(v.devices[0]!.state, "Heart rate, no reading");
  });
  it("lost source: a dash and the lost plate, and the other connected source is not used silently", () => {
    const s = new FakeSensorSource()
      .add("a", "Bike A", ["cadence"], { cadence: { value: 90, at: T } })
      .add("b", "Bike B", ["cadence"], { cadence: { value: 70, at: T } })
      .lose("a");
    const v = rows(s, freshValues(s.snapshot(), T));
    const cadence = v.measures.find((m) => m.measure === "cadence")!;
    assert.equal(cadence.value, null);
    assert.equal(cadence.lost, true);
    assert.equal(cadence.gauge?.tick, null);
    assert.equal(v.state, TEXT.lost);
    assert.deepEqual(v.devices.map((d) => [d.name, d.state, d.action]), [["Bike A", "Cadence, lost", "Reconnect"], ["Bike B", TEXT.notUsed, "Disconnect"]]);
    // Reconnect, or Disconnect on the lost one, lets the other take the measure at once.
    s.disconnect("a");
    assert.equal(rows(s, freshValues(s.snapshot(), T)).measures[0]!.value, 70);
  });
  it("the first connected source of a measure is used; the other says connected, not used", () => {
    const s = new FakeSensorSource().add("a", "Bike A", ["cadence"], { cadence: { value: 90, at: T } }).add("b", "Bike B", ["cadence"], { cadence: { value: 70, at: T } });
    const v = rows(s, freshValues(s.snapshot(), T));
    assert.equal(v.measures[0]!.value, 90);
    assert.equal(v.devices[1]!.state, "connected, not used");
  });
  it("no FTP or max heart rate: percentages, no gauge, and a line says where to type them; cadence keeps its gauge", () => {
    const s = bike();
    const v = rows(s, freshValues(s.snapshot(), T), PLAN(), NO_NUMBERS);
    assert.deepEqual(v.measures.map((m) => [m.plan, m.gauge !== null]), [["Plan 85–92 % of max", false], ["Plan 95–105 % of FTP", false], ["Plan 90–100 rpm", true]]);
    assert.equal(v.noNumbers, TEXT.noNumbers);
    assert.equal(v.measures[0]!.value, 142);
  });
  it("the worst case cadence plan 100 to 110 gauges", () => {
    const s = bike();
    const v = rows(s, freshValues(s.snapshot(), T), PLAN({ from: 100, to: 110 }));
    assert.deepEqual(v.measures[2]!.gauge!.track, [83.5, 126.5]);
  });
  it("no class open: numbers alone", () => {
    const s = bike();
    const v = rows(s, freshValues(s.snapshot(), T), { interval: null, zone: null });
    assert.ok(v.measures.every((m) => m.gauge === null && m.plan === TEXT.noPlan && m.value !== null));
  });
  it("the chooser lists only devices that offer an allowed service, by name and service in words", () => {
    const s = new FakeSensorSource();
    s.connect();
    s.nearby = [{ id: "1", name: "Polar H10 A1B2C3", services: ["heartRate"] }, { id: "2", name: "Headphones", services: [] }];
    s.failed = "Polar H10 A1B2C3";
    const v = rows(s, freshValues(s.snapshot(), T));
    assert.deepEqual(v.nearby, [{ id: "1", name: "Polar H10 A1B2C3", service: "Heart rate" }]);
    assert.equal(v.choosing, true);
    assert.equal(v.failure, "Could not connect to Polar H10 A1B2C3. Check that it is awake.");
  });
  it("the shipped source is the stand-in: unavailable, no button, no drawer, nothing to choose", () => {
    const v = buildView(UNAVAILABLE_SOURCE.snapshot(), NONE.values, PLAN(), N);
    assert.deepEqual([v.state, v.line, v.canConnect, v.canOpen, v.choosing, v.measures.length], ["Not available yet", "Reading sensors on this computer is not set up yet.", false, false, false, 0]);
    UNAVAILABLE_SOURCE.connect();
    assert.equal(UNAVAILABLE_SOURCE.snapshot().state, "unavailable");
  });
  it("building the view changes nothing it was given: a reading changes no plan, interval or target (rules 5, 8, 11)", () => {
    const s = bike();
    const p = PLAN();
    const frozen = JSON.stringify([p, N, s.snapshot()]);
    const deep = (o: unknown): void => {
      if (o && typeof o === "object") Object.values(o).forEach(deep);
      Object.freeze(o);
    };
    deep(p);
    deep(s.snapshot());
    for (let t = T; t < T + 8000; t += 1000) buildView(s.snapshot(), freshValues(s.snapshot(), t), p, N);
    assert.equal(JSON.stringify([p, N, s.snapshot()]), frozen);
    assert.deepEqual(p.interval, IV({ from: 90, to: 100 }));
    // A different reading gives the same plan, band and track: only the tick moves.
    const lo = new FakeSensorSource().add("b", "B", ["cadence"], { cadence: { value: 60, at: T } });
    const hi = new FakeSensorSource().add("b", "B", ["cadence"], { cadence: { value: 130, at: T } });
    const [a, b] = [lo, hi].map((x) => rows(x, freshValues(x.snapshot(), T)).measures[0]!);
    assert.deepEqual([a!.plan, a!.gauge!.band, a!.gauge!.track, a!.zone], [b!.plan, b!.gauge!.band, b!.gauge!.track, b!.zone]);
  });
});

describe("a shown number steps at most once a second", () => {
  const f = (heartRate: number | null) => ({ heartRate, power: null, cadence: null });
  it("holds for a second, then steps; a lapse to missing is at once", () => {
    let h = step(NONE, f(140), 0);
    assert.equal(h.values.heartRate, 140);
    h = step(h, f(141), 400);
    h = step(h, f(142), 999);
    assert.equal(h.values.heartRate, 140);
    h = step(h, f(142), 1000);
    assert.equal(h.values.heartRate, 142);
    h = step(h, f(null), 1100);
    assert.equal(h.values.heartRate, null);
    h = step(h, f(150), 1200);
    assert.equal(h.values.heartRate, 150);
  });
  it("over 10 s of fast readings the number changes at most 10 times", () => {
    let h = NONE;
    let changes = 0;
    for (let t = 0; t <= 10_000; t += 50) {
      const n = step(h, f(100 + (t / 50)), t);
      if (n.values.heartRate !== h.values.heartRate) changes++;
      h = n;
    }
    assert.ok(changes <= 11, String(changes));
  });
});

describe("the words (S9) and the tokens", () => {
  const NEVER = /too high|too low|in range|target heart rate zone|adjust|push|ease off|go up|slow down|speed up/i;
  it("no string of the panel tells anyone what to do", () => {
    const all = [...Object.values(TEXT), ...Object.values(LABEL), ...Object.values(SERVICE_WORDS), failedLine("Polar H10"), planLine("157–170 bpm"), planLine(null), measuresWords(["power", "cadence"])];
    for (const t of all) assert.doesNotMatch(t, NEVER, t);
  });
  it("measures in words", () => {
    assert.equal(measuresWords(["power", "cadence"]), "Power and cadence");
    assert.equal(measuresWords(["heartRate"]), "Heart rate");
  });
  it("the zone hues equal the design tokens", () => {
    const css = readFileSync(join(REPO, "player", "app", "src", "renderer", "design", "tokens.css"), "utf8");
    for (const [z, hex] of Object.entries(ZONE_HUES)) assert.match(css, new RegExp(`--zone-${z}:\\s*${hex}\\b`, "i"), `zone ${z}`);
  });
});

describe("the recorded notifications drive the panel through the real parsers", () => {
  it("heart rate, power and cadence replayed from the fixtures show as numbers", async () => {
    const { replayInto } = await import("./fake-sensor-replay.ts");
    const s = new FakeSensorSource().add("h", "Strap", ["heartRate"]).add("b", "Bike", ["power", "cadence"]);
    const last = replayInto(s, "h", "heartRate", 5000);
    replayInto(s, "b", "indoorBike", 5000);
    assert.equal(last, 2000);
    const v = buildView(s.snapshot(), freshValues(s.snapshot(), 7100), PLAN(), N);
    assert.deepEqual(v.measures.map((m) => m.value), [76, 252, 91]);
  });
});
