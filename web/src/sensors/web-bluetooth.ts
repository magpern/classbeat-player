// The browser's sensor source (ADR 0012, sections 1 and 3): the only file that names the browser's
// Bluetooth API (the sensor guard pins it). Read only: it asks for the allowlisted services, gets
// their measurement characteristics and switches on notifications. It writes nothing, and the
// readings go to the page's memory only, never sent, stored or logged.
import { decode, type Kind } from "./core/decode.ts";
import type { Crank } from "./core/crank.ts";
import type { Stamped } from "./core/freshness.ts";
import type { Measure } from "./core/readings.ts";
import { CHARACTERISTICS, SERVICES } from "./core/uuids.ts";
import { Listeners, unavailableSource, type SensorSource } from "./source.ts";

// The few parts of the Web Bluetooth API used here (TypeScript's DOM library has none).
interface Characteristic extends EventTarget {
  readonly value?: DataView;
  startNotifications(): Promise<Characteristic>;
}
interface Service {
  getCharacteristic(uuid: number): Promise<Characteristic>;
}
interface Server {
  readonly connected: boolean;
  connect(): Promise<Server>;
  disconnect(): void;
  getPrimaryService(uuid: number): Promise<Service>;
}
interface Device extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: Server;
}
interface Api {
  requestDevice(options: { filters: { services: number[] }[]; optionalServices: number[] }): Promise<Device>;
}

/** Each allowlisted service, its one measurement characteristic, and what it gives at first. */
const READS: readonly { service: number; characteristic: number; kind: Kind; gives: readonly Measure[] }[] = [
  { service: SERVICES.heartRate, characteristic: CHARACTERISTICS.heartRateMeasurement, kind: "hr", gives: ["hr"] },
  { service: SERVICES.cyclingPower, characteristic: CHARACTERISTICS.cyclingPowerMeasurement, kind: "power", gives: ["power"] },
  { service: SERVICES.fitnessMachine, characteristic: CHARACTERISTICS.indoorBikeData, kind: "bike", gives: ["power", "cadence"] },
  { service: SERVICES.cyclingSpeedCadence, characteristic: CHARACTERISTICS.cscMeasurement, kind: "csc", gives: ["cadence"] },
];
const ALL_SERVICES = READS.map((r) => r.service);

export function webBluetoothSource(nav: Navigator = navigator, win: Window = window): SensorSource {
  const api = (nav as Navigator & { bluetooth?: Api }).bluetooth;
  if (!api || typeof api.requestDevice !== "function") return unavailableSource();
  const listeners = new Listeners();
  const devices = new Map<string, Device>();
  const leaving = new Set<string>();
  // One set of characteristic listeners per device: a new subscribe ends the last one's, so a
  // reconnect or a second pick of the same sensor never doubles its readings.
  const subscriptions = new Map<string, AbortController>();
  // Each device object gets one "gattserverdisconnected" listener, however often it is picked.
  const watched = new WeakSet<Device>();
  // Bumped when the rider leaves (disconnectAll): a pick or a connection that finishes after that
  // belongs to a page that let go of its sensors, so it is disconnected and nothing is emitted.
  let epoch = 0;
  // Devices on their FIRST connection (a count: a stale attempt may still end after a new pick).
  // Only a connected device is kept for reconnect; one that drops or is removed before that must
  // clear the page's "choosing", which "lost" and "removed" do not.
  const connecting = new Map<string, number>();
  // Devices the page has listed (they reached "connected"). One of these stays registered when a
  // pick or reconnect of it ends badly: its row stays "lost" and Reconnect keeps working
  // (docs/design/sensors.md: a lost sensor stays lost until Reconnect; "the list stays").
  const shown = new Set<string>();
  const now = (): number => win.performance.now();
  /** A connection that finished after the page let go of it (left, removed or superseded). */
  class Left extends Error {}

  const subscribe = async (d: Device, at: number): Promise<void> => {
    const server = d.gatt;
    if (!server) throw new Error("no server");
    subscriptions.get(d.id)?.abort();
    const sub = new AbortController();
    subscriptions.set(d.id, sub);
    const still = (): void => {
      if (epoch !== at || sub.signal.aborted) throw new Left();
    };
    // A failure after the page let go of this connection (removed, left, lost or superseded) is
    // not news: it becomes a Left, so no "failed" follows "removed" or "lost".
    try {
      await connectAndRead(d, server, sub, still);
    } catch (e) {
      if (e instanceof Left) throw e;
      still();
      throw e;
    }
  };

  const connectAndRead = async (d: Device, server: Server, sub: AbortController, still: () => void): Promise<void> => {
    await server.connect();
    still();
    const gives = new Set<Measure>();
    const cranks = new Map<Kind, Stamped<Crank>>();
    for (const r of READS) {
      let ch: Characteristic;
      try {
        ch = await (await server.getPrimaryService(r.service)).getCharacteristic(r.characteristic);
      } catch {
        continue; // the device does not have this service
      }
      still();
      const read = (): void => {
        if (!ch.value) return;
        const t = now();
        const out = decode(r.kind, ch.value, cranks.get(r.kind) ?? null, t);
        if (out.crank) cranks.set(r.kind, out.crank);
        for (const x of out.readings) listeners.emit({ type: "sample", id: d.id, measure: x.measure, value: x.value, at: t });
      };
      ch.addEventListener("characteristicvaluechanged", read, { signal: sub.signal });
      await ch.startNotifications();
      still();
      r.gives.forEach((m) => gives.add(m));
    }
    still(); // the last lookup may have failed after a removal: no "connected" after "removed"
    if (!gives.size) throw new Error("nothing to read");
    shown.add(d.id);
    listeners.emit({ type: "connected", id: d.id, name: d.name?.trim() || "Sensor", gives: [...gives], at: now() });
  };

  /** Lets go of a device the page does not keep: its listeners end and it is disconnected. */
  const release = (d: Device): void => {
    leaving.add(d.id);
    shown.delete(d.id);
    subscriptions.get(d.id)?.abort();
    subscriptions.delete(d.id);
    d.gatt?.disconnect();
    devices.delete(d.id);
  };

  /** A listed sensor whose connection failed: its listeners end and its link closes (the row says
   * lost, so the link must not stay open, or a new pick would find it connected and do nothing),
   * but it stays registered for Reconnect. */
  const hold = (d: Device): void => {
    subscriptions.get(d.id)?.abort();
    d.gatt?.disconnect();
  };

  /** After a Left: disconnect the device unless a newer connection of this page now holds it. */
  const settle = (d: Device, at: number): void => {
    if (epoch !== at || !devices.has(d.id)) release(d);
  };

  const drop = (id: string): void => {
    const d = devices.get(id);
    if (d) release(d);
    leaving.add(id);
    listeners.emit({ type: "removed", id });
    if (connecting.has(id)) listeners.emit({ type: "closed" }); // the pick it belonged to ends here
  };

  const source: SensorSource = {
    supported: true,
    failDetail: "Check that Bluetooth is on and the sensor is awake.",
    now,
    connect() {
      const at = epoch;
      listeners.emit({ type: "choosing" });
      api.requestDevice({ filters: ALL_SERVICES.map((s) => ({ services: [s] })), optionalServices: ALL_SERVICES }).then(
        async (d) => {
          if (epoch !== at) return release(d); // picked after the rider left
          if (devices.has(d.id) && d.gatt?.connected) return listeners.emit({ type: "closed" }); // already read
          if (!watched.has(d)) {
            watched.add(d);
            d.addEventListener("gattserverdisconnected", () => {
              if (leaving.has(d.id) || !devices.has(d.id)) return;
              if (!shown.has(d.id)) {
                // Dropped before it ever connected: let go of it and clear "choosing" (the page
                // ignores "lost" for a device it never showed), so the rider can pick again.
                release(d);
                return listeners.emit({ type: "failed" });
              }
              subscriptions.get(d.id)?.abort(); // a lookup still running must not say "connected" after "lost"
              listeners.emit({ type: "lost", id: d.id });
              // A pick of a listed (lost) sensor that drops again ends here: the row stays lost,
              // Reconnect still works, and "choosing" clears.
              if (connecting.has(d.id)) listeners.emit({ type: "failed" });
            });
          }
          devices.set(d.id, d);
          leaving.delete(d.id);
          connecting.set(d.id, (connecting.get(d.id) ?? 0) + 1);
          try {
            await subscribe(d, at);
          } catch (e) {
            if (e instanceof Left) return settle(d, at);
            if (shown.has(d.id)) hold(d); // a listed sensor stays, lost, for Reconnect
            else release(d);
            listeners.emit({ type: "failed" });
          } finally {
            const n = (connecting.get(d.id) ?? 1) - 1;
            if (n > 0) connecting.set(d.id, n);
            else connecting.delete(d.id);
          }
        },
        (err: unknown) => {
          if (epoch === at) listeners.emit({ type: (err as { name?: string } | null)?.name === "NotFoundError" ? "closed" : "failed" });
        },
      );
    },
    reconnect(id) {
      const d = devices.get(id);
      if (!d) return;
      listeners.emit({ type: "retry", id });
      const at = epoch;
      subscribe(d, at).catch((e: unknown) => {
        if (e instanceof Left) return settle(d, at);
        hold(d);
        listeners.emit({ type: "lost", id });
      });
    },
    disconnect: drop,
    disconnectAll() {
      epoch += 1;
      [...devices.keys()].forEach(drop);
    },
    listen: (cb) => listeners.add(cb),
  };
  win.addEventListener("pagehide", () => source.disconnectAll());
  return source;
}

/** The rider page's entry takes its source by this neutral name (package.json, "#browser-sensors"). */
export const browserSensors = (): SensorSource => webBluetoothSource();
