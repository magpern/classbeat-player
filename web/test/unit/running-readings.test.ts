// A treadmill's and a foot pod's readings on the rider page (ADR 0015 sections 3 to 5; docs/design/running-class.md,
// "The readings"; issue #771): the browser source on a scripted fake reads only notifications, the model holds a reading
// for 3 s and keeps steps a minute apart from a bike's rpm, and the view gives numbers only, never a gauge or a colour.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { WEB_DIR } from "../lib/browser.ts";
import { deviceWords, measureNow, NO_SENSORS, sourceState, step, type SensorEvent, type Sensors } from "../../src/sensors/core/readings.ts";
import { runNow, runText, usedForRun } from "../../src/sensors/core/run-readings.ts";
import { hexToView } from "../../src/sensors/fake-replay.ts";
import { sensorView, stepShown } from "../../src/rider/core/sensor-view.ts";
import type { Effort } from "../../src/rider/core/effort-calc.ts";
import { unavailableSource } from "../../src/sensors/source.ts";
import { webBluetoothSource } from "#browser-sensors";

const recorded = JSON.parse(readFileSync(join(WEB_DIR, "fixtures", "sensors", "running.json"), "utf8")) as { treadmill: { hex: string }[]; rsc: { hex: string }[] };
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
};

/** A fake device with some services, each with the characteristics given; every call is logged. */
function fake(id: string, name: string, has: Record<number, number[]>) {
  const log: string[] = [];
  const chars = new Map<number, EventTarget & { value?: DataView; startNotifications(): Promise<unknown> }>();
  const gatt = {
    connected: false,
    connect: async () => ((gatt.connected = true), gatt),
    disconnect: () => void (gatt.connected = false),
    getPrimaryService: async (s: number) => {
      log.push(`service ${s.toString(16)}`);
      if (!has[s]) throw new DOMException("no service", "NotFoundError");
      return {
        getCharacteristic: async (c: number) => {
          log.push(`characteristic ${c.toString(16)}`);
          if (!has[s].includes(c)) throw new DOMException("no characteristic", "NotFoundError");
          const ch = Object.assign(new EventTarget(), {
            value: undefined as DataView | undefined,
            startNotifications: async () => (log.push(`notify ${c.toString(16)}`), ch),
          });
          chars.set(c, ch);
          return ch;
        },
      };
    },
  };
  const device = Object.assign(new EventTarget(), { id, name, gatt });
  const send = (c: number, hex: string): void => {
    const ch = chars.get(c);
    assert.ok(ch, `no characteristic ${c.toString(16)}`);
    ch.value = hexToView(hex);
    ch.dispatchEvent(new Event("characteristicvaluechanged"));
  };
  return { device, log, send };
}

function page(clock: { t: number } = { t: 0 }) {
  const picks: ((d: unknown) => void)[] = [];
  const asked: { filters: { services: number[] }[]; optionalServices: number[] }[] = [];
  const nav = { bluetooth: { requestDevice: (o: (typeof asked)[number]) => (asked.push(o), new Promise((resolve) => picks.push(resolve))) } } as unknown as Navigator;
  const win = { performance: { now: () => clock.t }, addEventListener: () => {} } as unknown as Window;
  const source = webBluetoothSource(nav, win);
  const events: SensorEvent[] = [];
  source.listen((e) => events.push(e));
  const pick = async (d: unknown): Promise<void> => {
    source.connect();
    picks.shift()!(d);
    await flush();
  };
  return { source, events, pick, asked, state: (): Sensors => events.reduce(step, NO_SENSORS) };
}

describe("the browser source and a treadmill or foot pod", () => {
  it("a treadmill: reads Treadmill Data by notification, gives speed and incline, never a bike's measures", async () => {
    const p = page();
    const tm = fake("tm", "Treadmill", { 0x1826: [0x2acd] });
    await p.pick(tm.device);
    assert.deepEqual(tm.log, ["service 180d", "service 1818", "service 1826", "characteristic 2ad2", "service 1816", "service 1826", "characteristic 2acd", "notify 2acd", "service 1814"]);
    tm.send(0x2acd, recorded.treadmill[2].hex);
    const s = p.state();
    assert.deepEqual([s.devices[0].gives, s.devices[0].runs], [[], ["speed", "incline"]]);
    assert.deepEqual([runNow(s, "speed", 0).value, runNow(s, "incline", 0).value], [11, 3]);
    assert.equal(measureNow(s, "cadence", 0).value, null);
  });

  it("a foot pod: reads Running Speed and Cadence, steps a minute are not a bike's rpm", async () => {
    const p = page();
    const pod = fake("pod", "Foot pod", { 0x1814: [0x2a53] });
    await p.pick(pod.device);
    pod.send(0x2a53, recorded.rsc[1].hex);
    const s = p.state();
    assert.deepEqual(s.devices[0].runs, ["speed", "stepCadence"]);
    assert.deepEqual([runNow(s, "stepCadence", 0).value, runNow(s, "speed", 0).value], [170, 10.8]);
    assert.equal(measureNow(s, "cadence", 0).device, null, "no bike cadence from a foot pod");
  });

  it("a bike still gives its own measures and no running ones", async () => {
    const p = page();
    const bike = fake("bike", "Bike", { 0x1826: [0x2ad2] });
    await p.pick(bike.device);
    assert.deepEqual([p.state().devices[0].gives, p.state().devices[0].runs], [["power", "cadence"], []]);
  });

  it("asks only for services of the allowlist and writes nothing", async () => {
    const p = page();
    await p.pick(fake("tm", "Treadmill", { 0x1826: [0x2acd] }).device);
    const asked = p.asked[0];
    const all = [...asked.filters.flatMap((f) => f.services), ...asked.optionalServices];
    assert.deepEqual([...new Set(all)].sort(), [0x180d, 0x1814, 0x1816, 0x1818, 0x1826]);
  });
});

describe("the readings in memory", () => {
  const tm = { type: "connected", id: "t", name: "Treadmill", gives: [], runs: ["speed", "incline"], at: 0 } as const;
  const pod = { type: "connected", id: "p", name: "Pod", gives: [], runs: ["speed", "stepCadence"], at: 0 } as const;
  const run = (...es: SensorEvent[]): Sensors => es.reduce(step, NO_SENSORS);
  const sample = (id: string, measure: "speed" | "incline" | "stepCadence", value: number, at: number): SensorEvent => ({ type: "run_sample", id, measure, value, at });

  it("a reading is held for 3 s and then missing, never the last number", () => {
    const s = run(tm, sample("t", "speed", 10.5, 1000));
    assert.equal(runNow(s, "speed", 4000).value, 10.5);
    assert.equal(runNow(s, "speed", 4001).value, null);
    assert.equal(runNow(s, "speed", 999).value, null, "from the future");
  });

  it("one source per measure: the first connected; foot-pod cadence is its own", () => {
    const s = run(tm, pod, sample("t", "speed", 11, 10), sample("p", "speed", 10.8, 10), sample("p", "stepCadence", 170, 10));
    assert.equal(usedForRun(s, "speed")?.id, "t");
    assert.deepEqual([runNow(s, "speed", 20).value, runNow(s, "stepCadence", 20).value, runNow(s, "incline", 20).value], [11, 170, null]);
  });

  it("out of range or from a lost device is no reading; a lost device clears its readings", () => {
    assert.equal(runNow(run(tm, sample("t", "speed", 41, 1)), "speed", 1).value, null);
    assert.equal(runNow(run(tm, sample("t", "stepCadence", 251, 1)), "stepCadence", 1).value, null);
    const lost = run(tm, sample("t", "speed", 10, 1), { type: "lost", id: "t" }, sample("t", "speed", 11, 2));
    assert.equal(runNow(lost, "speed", 2).value, null);
    assert.equal(sourceState(lost, true), "lost");
  });

  it("the sheet's words for each device", () => {
    const s = run(tm, pod);
    assert.deepEqual(s.devices.map((d) => deviceWords(s, d)), ["Speed and incline, connected", "Speed and cadence, connected"]);
  });

  it("text: speed and incline to one decimal, steps a minute whole, a dash for none", () => {
    assert.deepEqual([runText("speed", 9.5), runText("incline", 1), runText("stepCadence", 164), runText("speed", null)], ["9.5", "1.0", "164", "–"]);
  });
});

describe("the rider's view of a treadmill and a foot pod", () => {
  const effort: Effort = { rows: [{ label: "Heart rate", value: "157–170", unit: "bpm", range: [157, 170] }, { label: "RPE", value: "7–8", unit: "" }], hint: false };
  const tm = { type: "connected", id: "t", name: "Treadmill", gives: [], runs: ["speed", "incline"], at: 0 } as const;
  const view = (s: Sensors, shown = {}) => sensorView(effort, s, {}, 1000, true, "Try again.", shown);

  it("rows only for the measures a connected sensor gives, after the effort rows", () => {
    const b = view(step(NO_SENSORS, tm), { speed: 9.5, incline: 1 }).block;
    assert.deepEqual(b?.runs.map((r) => [r.label, r.text, r.unit]), [["Speed", "9.5", "km/h"], ["Incline", "1.0", "%"]]);
    assert.deepEqual(b?.rows.map((r) => r.label), ["Heart rate", "RPE"], "the plan rows are as before");
  });

  it("numbers only: a row is a label, a text and a unit, whatever the value", () => {
    for (const v of [0, 9.5, 40]) {
      const r = view(step(NO_SENSORS, tm), { speed: v, incline: v }).block?.runs[0];
      assert.deepEqual(Object.keys(r ?? {}).sort(), ["aria", "label", "text", "unit"]);
    }
  });

  it("a missing reading is a dash with its unit kept", () => {
    const r = view(step(NO_SENSORS, tm)).block?.runs;
    assert.deepEqual(r?.map((x) => [x.text, x.unit]), [["–", "km/h"], ["–", "%"]]);
  });

  it("no sensor: no rows; the key says Connect a sensor", () => {
    const v = view(NO_SENSORS);
    assert.equal(v.block, null);
    assert.equal(v.key.label, "Connect a sensor");
  });

  it("is stepped at most once a second, a dash at once", () => {
    const a = stepShown(undefined, 9.5, 0);
    assert.equal(stepShown(a, 9.6, 500), a);
    assert.equal(stepShown(a, 9.6, 1000).value, 9.6);
    assert.equal(stepShown(a, null, 500).value, null);
  });
});

describe("the instructor's computer and the app's rider mode (ADR 0012 section 6)", () => {
  it("keep the unavailable source: it cannot connect, hears nothing, and the rider view shows no reading rows", () => {
    const source = unavailableSource();
    const heard: SensorEvent[] = [];
    source.listen((e) => heard.push(e));
    source.connect();
    source.reconnect("x");
    assert.deepEqual([source.supported, heard.length], [false, 0]);
    const effort: Effort = { rows: [{ label: "RPE", value: "7–8", unit: "" }], hint: false };
    const v = sensorView(effort, NO_SENSORS, {}, 0, source.supported, source.failDetail, { speed: 9.5 });
    assert.equal(v.block, null);
  });
});
