// Treadmill Data 0x2ACD and RSC 0x2A53 decoders (ADR 0015 sections 3, 4 and 6): every flag
// combination, short and malformed buffers (null, never a throw), the fixtures and the fake source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { WEB_DIR } from "../lib/browser.ts";
import { decodeRunning, parseRsc, parseTreadmill, runReading, type RunMeasure } from "../../src/sensors/core/index.ts";
import type { Measure } from "../../src/sensors/core/readings.ts";
import { replayRunning } from "../../src/sensors/fake-treadmill.ts";

const view = (bytes: number[]): DataView => new DataView(new Uint8Array(bytes).buffer);
const u16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
const fill = (n: number, v = 0): number[] => Array<number>(n).fill(v);

// Treadmill Data fields after the flags, in order, with their flag bit and size (bit0 is inverted).
const TM_SIZES = [2, 2, 3, 4, 4, 1, 1, 5, 1, 1, 2, 2, 4];

describe("treadmill data 0x2ACD", () => {
  it("every combination of the twelve optional flags (bits 1 to 12), speed present", () => {
    for (let mask = 0; mask < 1 << 12; mask++) {
      const bits = mask << 1; // bit0 stays 0: speed present
      let len = 2; // speed
      TM_SIZES.slice(1).forEach((s, i) => (len += mask & (1 << i) ? s : 0));
      const body = fill(len);
      body.splice(0, 2, ...u16(1234)); // speed 12.34
      const incAt = 2 + (bits & 2 ? 2 : 0) + (bits & 4 ? 3 : 0);
      if (bits & 8) body.splice(incAt, 2, ...u16(65536 - 25)); // -2.5 %
      const got = parseTreadmill(view([...u16(bits), ...body]));
      assert.equal(got?.kmh, 12.34, `mask ${mask}`);
      assert.equal(got?.inclinePct, bits & 8 ? -2.5 : undefined, `mask ${mask}`);
      assert.equal(parseTreadmill(view([...u16(bits), ...body.slice(0, -1)])), null, `short ${mask}`);
    }
  });

  it("no speed when bit0 is set (more data)", () => {
    assert.deepEqual(parseTreadmill(view([0x09, 0x00, ...u16(30), 0, 0])), { inclinePct: 3 });
  });

  it("inclination 'not available' is no reading", () => {
    assert.deepEqual(parseTreadmill(view([0x08, 0x00, ...u16(500), 0xff, 0x7f, 0xff, 0x7f])), { kmh: 5 });
  });

  it("never decodes total distance", () => {
    const a = parseTreadmill(view([0x04, 0x00, ...u16(500), 0, 0, 0]));
    const b = parseTreadmill(view([0x04, 0x00, ...u16(500), 255, 255, 255]));
    assert.deepEqual(a, { kmh: 5 });
    assert.deepEqual(b, a);
  });

  it("short and empty buffers are null, never a throw", () => {
    for (const bytes of [[], [0x00], [0x00, 0x00], [0x00, 0x00, 1], [0x08, 0x00, 1, 0, 1, 0, 1]]) assert.equal(parseTreadmill(view(bytes)), null, String(bytes));
  });

  it("extra trailing bytes and reserved flag bits are ignored", () => {
    assert.deepEqual(parseTreadmill(view([0x00, 0xe0, ...u16(500), 9, 9])), { kmh: 5 });
  });
});

describe("running speed and cadence 0x2A53", () => {
  it("every combination of stride length and total distance", () => {
    for (let mask = 0; mask < 4; mask++) {
      const len = 4 + (mask & 1 ? 2 : 0) + (mask & 2 ? 4 : 0);
      const bytes = [mask, ...u16(768), 170, ...fill(len - 4, 0xff)];
      const got = parseRsc(view(bytes))!;
      assert.ok(Math.abs(got.kmh - 10.8) < 1e-9, `mask ${mask}`);
      assert.equal(got.stepsPerMin, 170);
      assert.equal(parseRsc(view(bytes.slice(0, -1))), null, `short ${mask}`);
    }
  });

  it("a buffer shorter than the flags promise is null", () => {
    assert.equal(parseRsc(view([0x01, 0x00, 0x03, 170, 0x64])), null);
    assert.equal(parseRsc(view([0x02, 0x00, 0x03, 170, 1, 2, 3])), null);
    assert.equal(parseRsc(view([])), null);
    assert.equal(parseRsc(view([0x00, 0x00, 0x03])), null);
  });

  it("the running flag and distance do not change the decoded values", () => {
    const a = parseRsc(view([0x00, ...u16(256), 90]));
    const b = parseRsc(view([0x06, ...u16(256), 90, 1, 2, 3, 4]));
    assert.deepEqual(a, b);
    assert.deepEqual(a, { kmh: 3.6, stepsPerMin: 90 });
  });
});

describe("running readings", () => {
  it("ranges and rounding", () => {
    assert.equal(runReading("speed", 10.04), 10);
    assert.equal(runReading("speed", 10.06), 10.1);
    assert.equal(runReading("speed", 41), null);
    assert.equal(runReading("speed", -0.1), null);
    assert.equal(runReading("incline", -2.5), -2.5);
    assert.equal(runReading("incline", 41), null);
    assert.equal(runReading("stepCadence", 170.4), 170);
    assert.equal(runReading("stepCadence", 251), null);
    assert.equal(runReading("speed", NaN), null);
    assert.equal(runReading("incline", Infinity), null);
  });

  it("a foot pod's cadence is its own kind, never the bike's", () => {
    const got = decodeRunning("rsc", view([0x00, ...u16(768), 170]));
    assert.deepEqual(got.map((r) => r.measure), ["speed", "stepCadence"]);
    assert.ok(got.every((r) => (r.measure as string) !== "cadence"));
    // At the type level: neither kind is assignable to the other.
    // @ts-expect-error a bike's cadence is not a running measure
    const a: RunMeasure = "cadence" as Measure;
    // @ts-expect-error a foot pod's steps a minute is not a bike measure
    const b: Measure = "stepCadence" as RunMeasure;
    void [a, b];
  });

  it("a treadmill gives speed and incline only; malformed gives nothing", () => {
    assert.deepEqual(decodeRunning("treadmill", view([0x08, 0x00, ...u16(1000), ...u16(20), 0, 0])), [{ measure: "speed", value: 10 }, { measure: "incline", value: 2 }]);
    assert.deepEqual(decodeRunning("treadmill", view([0x08, 0x00, 1])), []);
    assert.deepEqual(decodeRunning("rsc", view([])), []);
  });

  it("an out-of-range value is dropped, the others stay", () => {
    assert.deepEqual(decodeRunning("treadmill", view([0x08, 0x00, ...u16(9000), ...u16(20), 0, 0])), [{ measure: "incline", value: 2 }]);
  });
});

describe("recorded fixtures through the fake source", () => {
  const fx = JSON.parse(readFileSync(join(WEB_DIR, "fixtures", "sensors", "running.json"), "utf8"));
  const want = (key: "treadmill" | "rsc", measures: RunMeasure[], names: string[]) =>
    fx[key].flatMap((e: Record<string, number>) => measures.map((measure, i) => ({ t: e.t, measure, value: e[names[i]!] })));
  it("treadmill", () => {
    assert.deepEqual(replayRunning("treadmill", fx.treadmill), want("treadmill", ["speed", "incline"], ["kmh", "inclinePct"]));
  });
  it("foot pod", () => {
    assert.deepEqual(replayRunning("rsc", fx.rsc), want("rsc", ["speed", "stepCadence"], ["kmh", "stepsPerMin"]));
  });
});
