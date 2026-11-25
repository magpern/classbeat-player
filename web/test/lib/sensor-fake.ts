// A fake of the browser's sensor API for the rider page's checks (docs/design/sensors.md; issue
// #663): no radio, no real device. An init script puts a scripted `navigator.bluetooth` in the page
// (or takes it away), and the test drives it: which device the browser's list returns, its
// measurements, a lost connection. Every call the page makes is noted, so a test can show that the
// page asked only for the allowlisted services, wrote nothing and only switched on notifications.
import type { Page } from "playwright-core";

/** "fake": a scripted API; "none": the browser has no API (Safari, Firefox, the Android app's WebView). */
export type SensorApi = "fake" | "none";

export interface FakeDevice {
  readonly id: string;
  readonly name: string;
  /** The 16-bit services it has. */
  readonly services: readonly number[];
  /** The measurement characteristics it has; the one of each service's own kind when not given (a treadmill and a bike share a service). */
  readonly characteristics?: readonly number[];
}

export const STRAP: FakeDevice = { id: "strap", name: "Polar H10 A1B2C3", services: [0x180d] };
export const BIKE: FakeDevice = { id: "bike", name: "Wahoo KICKR 4F2E", services: [0x1826] };
/** A treadmill (Treadmill Data 0x2ACD in the Fitness Machine service) and a foot pod (Running Speed and Cadence 0x2A53). */
export const TREADMILL: FakeDevice = { id: "treadmill", name: "Life Fitness T5 8C21", services: [0x1826], characteristics: [0x2acd] };
export const FOOT_POD: FakeDevice = { id: "foot-pod", name: "Stryd 5521", services: [0x1814] };

export const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

/** A heart rate measurement (0x2A37): 8-bit value. */
export const hrBytes = (bpm: number): number[] => [0x00, bpm];
/** The recorded notifications of a treadmill and a foot pod (web/fixtures/sensors/running.json), as bytes. */
export const hexBytes = (hex: string): number[] => (hex.match(/../g) ?? []).map((h) => parseInt(h, 16));

/** Indoor bike data (0x2AD2): speed, cadence (0.5 rpm) and power present. */
export const bikeBytes = (watts: number, rpm: number): number[] => {
  const c = rpm * 2;
  return [0x44, 0x00, 0x00, 0x00, c & 0xff, c >> 8, watts & 0xff, (watts >> 8) & 0xff];
};

// Runs in the page before its own script (an init script is not subject to the page's CSP).
export function installSensorApi(o: { api: SensorApi }): void {
  type Trap = { kind: string; detail: string };
  const note = (detail: string): void => void ((globalThis as unknown as { __traps?: Trap[] }).__traps ?? []).push({ kind: "sensor", detail });
  if (o.api === "none") {
    delete (Navigator.prototype as unknown as { bluetooth?: unknown }).bluetooth;
    return;
  }
  type Dev = { id: string; name: string; services: number[]; characteristics?: number[] };
  const chars = new Map<string, EventTarget & { value?: DataView }>();
  const devices = new Map<string, EventTarget & { gatt: { connected: boolean } }>();
  let pending: { resolve: (d: unknown) => void; reject: (e: unknown) => void } | null = null;
  const MEASURE: Record<number, number[]> = { 0x180d: [0x2a37], 0x1818: [0x2a63], 0x1826: [0x2ad2], 0x1816: [0x2a5b], 0x1814: [0x2a53] };
  const write = (what: string) => () => {
    note(`write ${what}`);
    return Promise.reject(new DOMException("not allowed", "NotSupportedError"));
  };
  const make = (spec: Dev) => {
    const dev = new EventTarget() as EventTarget & Record<string, unknown>;
    const gatt = {
      connected: false,
      connect: async () => {
        note(`connect ${spec.id}`);
        gatt.connected = true;
        return gatt;
      },
      disconnect: () => {
        note(`disconnect ${spec.id}`);
        gatt.connected = false;
      },
      getPrimaryService: async (s: number) => {
        note(`service ${s.toString(16)}`);
        if (!spec.services.includes(s)) throw new DOMException("no service", "NotFoundError");
        return {
          getCharacteristic: async (c: number) => {
            note(`characteristic ${c.toString(16)}`);
            if (!(spec.characteristics ?? MEASURE[s]).includes(c)) throw new DOMException("no characteristic", "NotFoundError");
            const ch = new EventTarget() as EventTarget & Record<string, unknown>;
            ch.startNotifications = async () => (note(`notify ${c.toString(16)}`), ch);
            ch.stopNotifications = async () => (note(`stop ${c.toString(16)}`), ch);
            ch.readValue = async () => (note(`read ${c.toString(16)}`), new DataView(new ArrayBuffer(0)));
            ch.writeValue = write(c.toString(16));
            ch.writeValueWithResponse = write(c.toString(16));
            ch.writeValueWithoutResponse = write(c.toString(16));
            chars.set(`${spec.id}:${c}`, ch as never);
            return ch;
          },
        };
      },
    };
    Object.assign(dev, { id: spec.id, name: spec.name, gatt });
    devices.set(spec.id, dev as never);
    return dev;
  };
  Object.defineProperty(navigator, "bluetooth", {
    configurable: true,
    value: {
      requestDevice: (opts: unknown) => {
        note(`request ${JSON.stringify(opts)}`);
        return new Promise((resolve, reject) => (pending = { resolve, reject }));
      },
    },
  });
  (globalThis as unknown as Record<string, unknown>).__sensors = {
    pick: (spec: Dev) => {
      const d = devices.get(spec.id) ?? make(spec);
      pending?.resolve(d);
      pending = null;
    },
    cancel: () => {
      pending?.reject(new DOMException("closed", "NotFoundError"));
      pending = null;
    },
    refuse: () => {
      pending?.reject(new DOMException("failed", "NetworkError"));
      pending = null;
    },
    notify: (id: string, c: number, bytes: number[]) => {
      const ch = chars.get(`${id}:${c}`);
      if (!ch) throw new Error(`no characteristic ${id}:${c}`);
      ch.value = new DataView(new Uint8Array(bytes).buffer);
      ch.dispatchEvent(new Event("characteristicvaluechanged"));
    },
    drop: (id: string) => {
      const d = devices.get(id);
      if (!d) throw new Error(`no device ${id}`);
      d.gatt.connected = false;
      d.dispatchEvent(new Event("gattserverdisconnected"));
    },
  };
}

type Drive = { pick(d: FakeDevice): void; cancel(): void; refuse(): void; notify(id: string, c: number, b: number[]): void; drop(id: string): void };
// Each function below runs in the page, so it names the page's handle itself.

/** The browser's list returns this device. */
export const pick = (page: Page, d: FakeDevice): Promise<void> => page.evaluate((x) => (globalThis as unknown as { __sensors: Drive }).__sensors.pick(x), d);
/** The rider closed the browser's list with nothing picked. */
export const cancel = (page: Page): Promise<void> => page.evaluate(() => (globalThis as unknown as { __sensors: Drive }).__sensors.cancel());
/** The chosen device would not connect. */
export const refuse = (page: Page): Promise<void> => page.evaluate(() => (globalThis as unknown as { __sensors: Drive }).__sensors.refuse());
export const notify = (page: Page, id: string, characteristic: number, bytes: number[]): Promise<void> =>
  page.evaluate(([i, c, b]) => (globalThis as unknown as { __sensors: Drive }).__sensors.notify(i, c, b), [id, characteristic, bytes] as const);
export const drop = (page: Page, id: string): Promise<void> => page.evaluate((i) => (globalThis as unknown as { __sensors: Drive }).__sensors.drop(i), id);
