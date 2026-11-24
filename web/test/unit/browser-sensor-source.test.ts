// The browser's sensor source (src/sensors/web-bluetooth.ts; issue #663) on a scripted fake of the
// browser's API: a sensor picked or connected after the rider left is let go, and no pick, reconnect
// or second pick of the same sensor ever doubles its listeners or its readings.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SensorEvent } from "../../src/sensors/core/readings.ts";
import { webBluetoothSource } from "#browser-sensors";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
};
const gate = (): { promise: Promise<void>; open: () => void } => {
  let open = (): void => {};
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
};

/** A heart rate strap whose characteristic is one object, as the browser gives it. */
function strap(id = "strap") {
  const ch = Object.assign(new EventTarget(), { value: undefined as DataView | undefined, startNotifications: async () => ch });
  let hold: Promise<void> | null = null;
  const log: string[] = [];
  const gatt = {
    connected: false,
    connect: async () => {
      log.push("connect");
      if (hold) await hold;
      gatt.connected = true;
      return gatt;
    },
    disconnect: () => {
      log.push("disconnect");
      gatt.connected = false;
    },
    getPrimaryService: async (s: number) => {
      if (s !== 0x180d) throw new DOMException("no service", "NotFoundError");
      return { getCharacteristic: async () => ch };
    },
  };
  const device = Object.assign(new EventTarget(), { id, name: "Strap", gatt });
  return {
    device,
    log,
    holdConnect: (p: Promise<void> | null) => void (hold = p),
    beat: (bpm: number) => {
      ch.value = new DataView(new Uint8Array([0, bpm]).buffer);
      ch.dispatchEvent(new Event("characteristicvaluechanged"));
    },
    lose: () => {
      gatt.connected = false;
      device.dispatchEvent(new Event("gattserverdisconnected"));
    },
  };
}

function page() {
  const picks: { resolve: (d: unknown) => void }[] = [];
  const nav = { bluetooth: { requestDevice: () => new Promise((resolve) => picks.push({ resolve })) } } as unknown as Navigator;
  const win = { performance: { now: () => 0 }, addEventListener: () => {} } as unknown as Window;
  const source = webBluetoothSource(nav, win);
  const events: SensorEvent[] = [];
  source.listen((e) => events.push(e));
  const pick = async (d: unknown): Promise<void> => {
    picks.shift()!.resolve(d);
    await flush();
  };
  const types = (): string[] => events.map((e) => e.type);
  const samples = (): number => events.filter((e) => e.type === "sample").length;
  return { source, events, pick, types, samples };
}

describe("a sensor after the rider left", () => {
  it("picked after leaving: disconnected, never connected, nothing said", async () => {
    const p = page();
    const s = strap();
    p.source.connect();
    p.source.disconnectAll();
    await p.pick(s.device);
    assert.equal(s.device.gatt.connected, false);
    assert.ok(!s.log.includes("connect"), s.log.join());
    assert.deepEqual(p.types(), ["choosing"]);
  });

  it("left while it was connecting: disconnected once the connection ends, no reading", async () => {
    const p = page();
    const s = strap();
    const g = gate();
    s.holdConnect(g.promise);
    p.source.connect();
    await p.pick(s.device);
    p.source.disconnectAll();
    g.open();
    await flush();
    assert.equal(s.device.gatt.connected, false);
    s.beat(150);
    assert.ok(!p.types().includes("connected"), p.types().join());
    assert.equal(p.samples(), 0);
  });

  it("removed while it was connecting: disconnected, no reading", async () => {
    const p = page();
    const s = strap();
    const g = gate();
    s.holdConnect(g.promise);
    p.source.connect();
    await p.pick(s.device);
    p.source.disconnect(s.device.id);
    g.open();
    await flush();
    assert.equal(s.device.gatt.connected, false);
    s.beat(150);
    assert.equal(p.samples(), 0);
  });

  it("a new pick after leaving still connects", async () => {
    const p = page();
    p.source.connect();
    p.source.disconnectAll();
    await p.pick(strap("old").device);
    const s = strap();
    p.source.connect();
    await p.pick(s.device);
    assert.equal(s.device.gatt.connected, true);
    assert.equal(p.types().at(-1), "connected");
  });
});

describe("one listener per sensor", () => {
  it("picking a sensor that is already connected changes nothing", async () => {
    const p = page();
    const s = strap();
    p.source.connect();
    await p.pick(s.device);
    p.source.connect();
    await p.pick(s.device);
    assert.deepEqual(p.types(), ["choosing", "connected", "choosing", "closed"]);
    s.beat(150);
    assert.equal(p.samples(), 1);
  });

  it("a reconnect after a lost connection: one reading per notification, one lost per drop", async () => {
    const p = page();
    const s = strap();
    p.source.connect();
    await p.pick(s.device);
    s.lose();
    p.source.reconnect(s.device.id);
    await flush();
    s.beat(150);
    assert.equal(p.samples(), 1);
    s.lose();
    assert.equal(p.types().filter((t) => t === "lost").length, 2);
  });

  it("a lost sensor picked again: one reading per notification, one lost per drop", async () => {
    const p = page();
    const s = strap();
    p.source.connect();
    await p.pick(s.device);
    s.lose();
    p.source.connect();
    await p.pick(s.device);
    s.beat(150);
    assert.equal(p.samples(), 1);
    s.lose();
    assert.equal(p.types().filter((t) => t === "lost").length, 2);
  });

  it("removed, then picked again: one reading per notification, one lost per drop", async () => {
    const p = page();
    const s = strap();
    p.source.connect();
    await p.pick(s.device);
    p.source.disconnect(s.device.id);
    p.source.connect();
    await p.pick(s.device);
    s.beat(150);
    assert.equal(p.samples(), 1);
    s.lose();
    assert.equal(p.types().filter((t) => t === "lost").length, 1);
  });

  it("a removed sensor reads nothing", async () => {
    const p = page();
    const s = strap();
    p.source.connect();
    await p.pick(s.device);
    p.source.disconnect(s.device.id);
    s.beat(150);
    assert.equal(p.samples(), 0);
  });
});
