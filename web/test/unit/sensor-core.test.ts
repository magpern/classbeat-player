// The pure sensor core (ADR 0012, section 2): table-driven over every flag combination, short and
// malformed buffers (null, never a throw), counter wrap-around, the 3 s rule and the fixtures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { WEB_DIR } from "../lib/browser.ts";
import { crankCadence, type Crank, fresh, parseCsc, parseCyclingPower, parseHeartRate, parseIndoorBike, CHARACTERISTICS, SERVICES, uuid128 } from "../../src/sensors/core/index.ts";
import { hexToView, replay } from "../../src/sensors/fake-replay.ts";

const view = (bytes: number[]): DataView => new DataView(new Uint8Array(bytes).buffer);
const u16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
const fill = (n: number, v = 0): number[] => Array<number>(n).fill(v);

/** Every subset of `sizes` (bit i set = field i present) with its byte length and offsets. */
function* subsets(sizes: number[]): Generator<{ mask: number; offsets: number[]; len: number }> {
  for (let mask = 0; mask < 1 << sizes.length; mask++) {
    const offsets: number[] = [];
    let len = 0;
    sizes.forEach((s, i) => {
      offsets[i] = len;
      if (mask & (1 << i)) len += s;
    });
    yield { mask, offsets, len };
  }
}

describe("heart rate 0x2A37", () => {
  const ok: Array<[string, number[], number]> = [
    ["8-bit", [0x00, 72], 72],
    ["16-bit", [0x01, ...u16(300)], 300],
    ["contact bits set", [0x06, 90], 90],
    ["energy", [0x08, 90, ...u16(5)], 90],
    ["RR", [0x10, 90, ...u16(800)], 90],
    ["two RR", [0x10, 90, ...u16(800), ...u16(790)], 90],
    ["16-bit, energy, RR", [0x19, ...u16(200), ...u16(9), ...u16(700)], 200],
  ];
  for (const [n, b, bpm] of ok) it(n, () => assert.deepEqual(parseHeartRate(view(b)), { bpm }));
  const bad: Array<[string, number[]]> = [
    ["empty", []], ["flags only", [0]], ["16-bit cut", [1, 5]], ["energy cut", [8, 90, 1]],
    ["RR flagged but absent", [0x10, 90]], ["RR cut", [0x10, 90, 1]],
  ];
  for (const [n, b] of bad) it(`rejects ${n}`, () => assert.equal(parseHeartRate(view(b)), null));
});

describe("CSC 0x2A5B", () => {
  for (const wheel of [0, 1]) for (const crank of [0, 1]) {
    it(`wheel ${wheel} crank ${crank}`, () => {
      const b = [wheel | (crank << 1), ...(wheel ? fill(6, 7) : []), ...(crank ? [...u16(40), ...u16(2048)] : [])];
      assert.deepEqual(parseCsc(view(b)), crank ? { crank: { revs: 40, time: 2048 } } : {});
    });
  }
  for (const [n, b] of [["empty", []], ["wheel cut", [1, 0, 0]], ["crank cut", [2, 0, 0, 0]], ["both, crank cut", [3, ...fill(6), 0]]] as Array<[string, number[]]>) {
    it(`rejects ${n}`, () => assert.equal(parseCsc(view(b)), null));
  }
});

describe("cycling power 0x2A63", () => {
  // balance, torque, wheel, crank, force, torque extremes, angles, top, bottom, energy (flag bits 0,2,4..11)
  const sizes = [1, 2, 6, 4, 4, 4, 3, 2, 2, 2];
  const bits = [0, 2, 4, 5, 6, 7, 8, 9, 10, 11];
  for (const { mask, offsets, len } of subsets(sizes)) {
    const flags = bits.reduce((a, bt, i) => a | (mask & (1 << i) ? 1 << bt : 0), 0) | (mask & 1 ? 0 : 0x2); // bit 1 (reference) has no field
    const body = fill(len);
    const hasCrank = (mask & 8) !== 0;
    if (hasCrank) body.splice(offsets[3], 4, ...u16(65000), ...u16(3000));
    const buf = [...u16(flags), ...u16(0xff9c), ...body]; // -100 W
    it(`flags ${flags.toString(16)}`, () => {
      assert.deepEqual(parseCyclingPower(view(buf)), hasCrank ? { watts: -100, crank: { revs: 65000, time: 3000 } } : { watts: -100 });
      if (len > 0) assert.equal(parseCyclingPower(view(buf.slice(0, -1))), null, "one byte short");
    });
  }
  for (const [n, b] of [["empty", []], ["no power", [0, 0]], ["flags only", [0, 0, 1]]] as Array<[string, number[]]>) {
    it(`rejects ${n}`, () => assert.equal(parseCyclingPower(view(b)), null));
  }
});

describe("indoor bike data 0x2AD2", () => {
  // speed (present when bit0 is 0), then bits 1..12: avg speed, cadence, avg cadence, distance, resistance, power, avg power, energy, hr, met, elapsed, remaining
  const sizes = [2, 2, 2, 2, 3, 2, 2, 2, 5, 1, 1, 2, 2]; // index 0 is speed (absent when flag bit 0 set)
  for (const { mask, offsets, len } of subsets(sizes)) {
    const flags = (mask & 1 ? 0 : 1) | (mask >> 1 << 1);
    const body = fill(len);
    if (mask & 4) body.splice(offsets[2], 2, ...u16(181)); // cadence 90.5
    if (mask & 64) body.splice(offsets[6], 2, ...u16(0xfff6)); // power -10
    if (mask & 512) body.splice(offsets[9], 1, 143);
    const want = { ...(mask & 4 && { cadence: 90.5 }), ...(mask & 64 && { watts: -10 }), ...(mask & 512 && { bpm: 143 }) };
    it(`flags ${flags.toString(16)}`, () => {
      assert.deepEqual(parseIndoorBike(view([...u16(flags), ...body])), want);
      if (len > 0) assert.equal(parseIndoorBike(view([...u16(flags), ...body.slice(0, -1)])), null);
    });
  }
  it("rejects empty and one byte", () => {
    assert.equal(parseIndoorBike(view([])), null);
    assert.equal(parseIndoorBike(view([0])), null);
  });
});

describe("crank cadence", () => {
  const at = (revs: number, time: number, t: number) => ({ value: { revs, time }, at: t });
  const near = (got: number | null, want: number, tol = 0.1) => assert.ok(got !== null && Math.abs(got - want) < tol, String(got));
  it("90 rpm from one revolution in 683/1024 s", () => near(crankCadence(at(100, 1000, 0), at(101, 1683, 700)), 90));
  it("revolution counter wraps", () => near(crankCadence(at(65535, 100, 0), at(1, 1465, 1400)), 90));
  it("event time wraps", () => near(crankCadence(at(10, 65000, 0), at(11, 147, 700)), 90, 0.2));
  it("both wrap", () => near(crankCadence(at(65535, 65500, 0), at(0, 647, 700)), 90));
  it("no new event is not a cadence", () => assert.equal(crankCadence(at(5, 9, 0), at(5, 9, 500)), null));
  it("an absurd step is not a cadence", () => assert.equal(crankCadence(at(0, 0, 0), at(30000, 100, 100)), null));
  it("a pair further apart than 3 s is not a cadence", () => {
    near(crankCadence(at(100, 1000, 0), at(101, 1683, 3000)), 90);
    assert.equal(crankCadence(at(100, 1000, 0), at(101, 1683, 3001)), null);
    assert.equal(crankCadence(at(100, 1000, 5000), at(101, 1683, 4000)), null);
  });
});

describe("trailing bytes are ignored by every parser", () => {
  it("each", () => {
    assert.deepEqual(parseHeartRate(view([0, 70, 9, 9, 9])), { bpm: 70 });
    assert.deepEqual(parseCsc(view([0, 9, 9])), {});
    assert.deepEqual(parseCyclingPower(view([0, 0, ...u16(50), 9, 9])), { watts: 50 });
    assert.deepEqual(parseIndoorBike(view([1, 0, 9, 9])), {});
  });
  it("heart rate with RR flagged and an odd tail", () => assert.deepEqual(parseHeartRate(view([0x10, 90, 1, 2, 3])), { bpm: 90 }));
});

describe("cycling power bits that carry no field", () => {
  // bit 1 (balance reference), bit 3 (torque source), bit 12 (offset compensation) add no bytes
  for (const [n, flags, len] of [["bit 3", 0x08, 0], ["bit 12", 0x1000, 0], ["bit 1 alone", 0x02, 0], ["bit 1 with balance", 0x03, 1], ["bits 1, 3, 12 with balance", 0x100b, 1]] as Array<[string, number, number]>) {
    it(n, () => {
      assert.deepEqual(parseCyclingPower(view([...u16(flags), ...u16(120), ...fill(len)])), { watts: 120 });
      if (len) assert.equal(parseCyclingPower(view([...u16(flags), ...u16(120)])), null);
    });
  }
});

describe("freshness (3 s)", () => {
  const s = { value: 88, at: 1000 };
  for (const [now, want] of [[1000, 88], [3999, 88], [4000, 88], [4001, null], [9000, null], [999, null]] as Array<[number, number | null]>) {
    it(`at ${now}`, () => assert.equal(fresh(s, now), want));
  }
  it("no sample", () => {
    assert.equal(fresh(null, 0), null);
    assert.equal(fresh(undefined, 0), null);
  });
});

describe("constants", () => {
  it("allowlist numbers and the 128-bit form", () => {
    assert.deepEqual(Object.values(SERVICES), [0x180d, 0x1816, 0x1818, 0x1826]);
    assert.deepEqual(Object.values(CHARACTERISTICS), [0x2a37, 0x2a5b, 0x2a63, 0x2ad2]);
    assert.equal(uuid128(0x2a37), "00002a37-0000-1000-8000-00805f9b34fb");
  });
});

describe("hand-built fixtures through the fake replay", () => {
  const fx = JSON.parse(readFileSync(join(WEB_DIR, "fixtures", "sensors", "notifications.json"), "utf8"));
  it("heart rate", () => {
    const got: number[] = [];
    replay(fx.heartRate, (v) => got.push(parseHeartRate(v)!.bpm));
    assert.deepEqual(got, fx.heartRate.map((e: { bpm: number }) => e.bpm));
  });
  for (const [key, parse] of [["csc", parseCsc], ["cyclingPower", parseCyclingPower]] as const) {
    it(`${key} cadence from the crank`, () => {
      const cranks = fx[key].map((e: { hex: string }) => parse(hexToView(e.hex))!.crank!);
      assert.deepEqual(cranks, fx[key].map((e: { revs: number; time: number }) => ({ revs: e.revs, time: e.time })));
      const stamped = cranks.map((value: Crank, i: number) => ({ value, at: fx[key][i].t }));
      assert.ok(Math.abs(crankCadence(stamped[0], stamped[1])! - 90) < 0.1);
    });
  }
  it("cycling power watts", () => assert.deepEqual(fx.cyclingPower.map((e: { hex: string }) => parseCyclingPower(hexToView(e.hex))!.watts), [200, 210]));
  it("indoor bike", () => {
    const got: unknown[] = [];
    const last = replay(fx.indoorBike, (v) => got.push(parseIndoorBike(v)));
    assert.equal(last, 1000);
    assert.deepEqual(got, [{ cadence: 90, watts: 250 }, { cadence: 91, watts: 252, bpm: 140 }]);
  });
});
