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
  const now = (): number => win.performance.now();

  const subscribe = async (d: Device): Promise<void> => {
    const server = d.gatt;
    if (!server) throw new Error("no server");
    await server.connect();
    const gives = new Set<Measure>();
    const cranks = new Map<Kind, Stamped<Crank>>();
    for (const r of READS) {
      let ch: Characteristic;
      try {
        ch = await (await server.getPrimaryService(r.service)).getCharacteristic(r.characteristic);
      } catch {
        continue; // the device does not have this service
      }
      ch.addEventListener("characteristicvaluechanged", () => {
        if (!ch.value) return;
        const at = now();
        const out = decode(r.kind, ch.value, cranks.get(r.kind) ?? null, at);
        if (out.crank) cranks.set(r.kind, out.crank);
        for (const x of out.readings) listeners.emit({ type: "sample", id: d.id, measure: x.measure, value: x.value, at });
      });
      await ch.startNotifications();
      r.gives.forEach((m) => gives.add(m));
    }
    if (!gives.size) throw new Error("nothing to read");
    listeners.emit({ type: "connected", id: d.id, name: d.name?.trim() || "Sensor", gives: [...gives], at: now() });
  };

  const drop = (id: string): void => {
    leaving.add(id);
    devices.get(id)?.gatt?.disconnect();
    devices.delete(id);
    listeners.emit({ type: "removed", id });
  };

  const source: SensorSource = {
    supported: true,
    failDetail: "Check that Bluetooth is on and the sensor is awake.",
    now,
    connect() {
      listeners.emit({ type: "choosing" });
      api.requestDevice({ filters: ALL_SERVICES.map((s) => ({ services: [s] })), optionalServices: ALL_SERVICES }).then(
        async (d) => {
          if (!devices.has(d.id)) {
            d.addEventListener("gattserverdisconnected", () => {
              if (leaving.has(d.id) || !devices.has(d.id)) return;
              listeners.emit({ type: "lost", id: d.id });
            });
          }
          devices.set(d.id, d);
          leaving.delete(d.id);
          try {
            await subscribe(d);
          } catch {
            leaving.add(d.id);
            d.gatt?.disconnect();
            devices.delete(d.id);
            listeners.emit({ type: "failed" });
          }
        },
        (err: unknown) => listeners.emit({ type: (err as { name?: string } | null)?.name === "NotFoundError" ? "closed" : "failed" }),
      );
    },
    reconnect(id) {
      const d = devices.get(id);
      if (!d) return;
      listeners.emit({ type: "retry", id });
      subscribe(d).catch(() => listeners.emit({ type: "lost", id }));
    },
    disconnect: drop,
    disconnectAll() {
      [...devices.keys()].forEach(drop);
    },
    listen: (cb) => listeners.add(cb),
  };
  win.addEventListener("pagehide", () => source.disconnectAll());
  return source;
}

/** The rider page's entry takes its source by this neutral name (package.json, "#browser-sensors"). */
export const browserSensors = (): SensorSource => webBluetoothSource();
