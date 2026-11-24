// The browser's sensor source (src/sensors/web-bluetooth.ts; issue #663) on a scripted fake of the
// browser's API: a sensor picked or connected after the rider left is let go, and no pick, reconnect
// or second pick of the same sensor ever doubles its listeners or its readings.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_SENSORS, step, type SensorEvent } from "../../src/sensors/core/readings.ts";
import { webBluetoothSource } from "#browser-sensors";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
};
const gate = (): { promise: Promise<void>; open: () => void; fail: () => void } => {
  let open = (): void => {};
  let fail = (): void => {};
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = () => reject(new DOMException("failed", "NetworkError"));
  });
  return { promise, open, fail };
};

/** A heart rate strap whose characteristic is one object, as the browser gives it. */
function strap(id = "strap") {
  let notifyHold: Promise<void> | null = null;
  const ch = Object.assign(new EventTarget(), {
    value: undefined as DataView | undefined,
    startNotifications: async () => {
      if (notifyHold) await notifyHold;
      return ch;
    },
  });
  let hold: Promise<void> | null = null;
  let lookupHold: Promise<void> | null = null;
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
      // The last service looked up (speed and cadence) can be held; after a disconnect it fails.
      if (s === 0x1816 && lookupHold) {
        await lookupHold;
        if (!gatt.connected) throw new DOMException("disconnected", "NetworkError");
      }
      if (s !== 0x180d) throw new DOMException("no service", "NotFoundError");
      return { getCharacteristic: async () => ch };
    },
  };
  const device = Object.assign(new EventTarget(), { id, name: "Strap", gatt });
  return {
    device,
    log,
    holdNotify: (p: Promise<void> | null) => void (notifyHold = p),
    holdLookup: (p: Promise<void> | null) => void (lookupHold = p),
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
  const state = () => events.reduce(step, NO_SENSORS);
  return { source, events, pick, types, samples, state };
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

  it("removed during the last service lookup, which then fails: no connected after removed", async () => {
    const p = page();
    const s = strap();
    const g = gate();
    s.holdLookup(g.promise);
    p.source.connect();
    await p.pick(s.device);
    p.source.disconnect(s.device.id);
    g.open();
    await flush();
    assert.ok(!p.types().includes("connected"), p.types().join());
    assert.deepEqual(p.types(), ["choosing", "removed", "closed"]);
    assert.equal(s.device.gatt.connected, false);
  });

  it("removed while connecting, then the connection fails: no failed after removed", async () => {
    const p = page();
    const s = strap();
    const g = gate();
    s.holdConnect(g.promise);
    p.source.connect();
    await p.pick(s.device);
    p.source.disconnect(s.device.id);
    g.fail();
    await flush();
    assert.deepEqual(p.types(), ["choosing", "removed", "closed"]);
  });

  it("removed while notifications start, then they fail: no failed after removed", async () => {
    const p = page();
    const s = strap();
    const g = gate();
    s.holdNotify(g.promise);
    p.source.connect();
    await p.pick(s.device);
    p.source.disconnect(s.device.id);
    g.fail();
    await flush();
    assert.deepEqual(p.types(), ["choosing", "removed", "closed"]);
  });

  it("left while connecting, then the connection fails: nothing said", async () => {
    const p = page();
    const s = strap();
    const g = gate();
    s.holdConnect(g.promise);
    p.source.connect();
    await p.pick(s.device);
    p.source.disconnectAll();
    g.fail();
    await flush();
    assert.deepEqual(p.types(), ["choosing", "removed", "closed"]);
  });

  it("a sensor that fails while the rider is still here says failed", async () => {
    const p = page();
    const s = strap();
    const g = gate();
    s.holdConnect(g.promise);
    p.source.connect();
    await p.pick(s.device);
    g.fail();
    await flush();
    assert.deepEqual(p.types(), ["choosing", "failed"]);
  });

  it("dropped during the first connection: failed, released, no stuck choosing, can pick again", async () => {
    const p = page();
    const s = strap();
    const g = gate();
    s.holdLookup(g.promise);
    p.source.connect();
    await p.pick(s.device);
    s.lose();
    g.open();
    await flush();
    assert.deepEqual(p.types(), ["choosing", "failed"]);
    assert.equal(p.state().choosing, false);
    assert.equal(p.state().devices.length, 0);
    p.source.reconnect(s.device.id); // not kept: nothing to reconnect
    s.holdLookup(null);
    p.source.connect();
    await p.pick(s.device);
    assert.equal(p.types().at(-1), "connected");
    assert.equal(p.state().choosing, false);
  });

  it("removed during the first connection: choosing is cleared", async () => {
    const p = page();
    const s = strap();
    const g = gate();
    s.holdConnect(g.promise);
    p.source.connect();
    await p.pick(s.device);
    p.source.disconnect(s.device.id);
    g.open();
    await flush();
    assert.equal(p.state().choosing, false);
  });

  it("lost during a reconnect's lookups: no connected after lost, and it can reconnect again", async () => {
    const p = page();
    const s = strap();
    p.source.connect();
    await p.pick(s.device);
    s.lose();
    const g = gate();
    s.holdLookup(g.promise);
    p.source.reconnect(s.device.id);
    await flush();
    s.lose();
    g.open();
    await flush();
    assert.deepEqual(p.types(), ["choosing", "connected", "lost", "retry", "lost"]);
    s.holdLookup(null);
    p.source.reconnect(s.device.id);
    await flush();
    assert.equal(p.types().at(-1), "connected");
    s.beat(120);
    assert.equal(p.samples(), 1);
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
