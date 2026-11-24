// A fake SensorSource for tests and the screenshot harness: it holds what a test puts in it. Nothing
// here opens Bluetooth, and it is browser-safe so the harness can bundle it; the shipped bundles never
// contain it. The recorded-notification replay is in fake-sensor-replay.ts.
import type { Measure, NearbyDevice, SensorDevice, SensorSource, SourceSnapshot, SourceState } from "../../src/core/sensors/types.ts";

export class FakeSensorSource implements SensorSource {
  state: SourceState = "idle";
  devices: SensorDevice[] = [];
  nearby: NearbyDevice[] = [];
  failed: string | null = null;
  readonly calls: string[] = [];
  private listeners = new Set<() => void>();

  snapshot(): SourceSnapshot {
    return { state: this.state, devices: this.devices, nearby: this.nearby, failed: this.failed };
  }
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  private changed(): void {
    for (const l of this.listeners) l();
  }
  connect(): void {
    this.calls.push("connect");
    this.state = "choosing";
    this.changed();
  }
  choose(id: string): void {
    this.calls.push(`choose ${id}`);
  }
  cancel(): void {
    this.calls.push("cancel");
    this.state = this.devices.length > 0 ? "connected" : "idle";
    this.failed = null;
    this.changed();
  }
  disconnect(id: string): void {
    this.calls.push(`disconnect ${id}`);
    this.devices = this.devices.filter((d) => d.id !== id);
    this.settle();
  }
  reconnect(id: string): void {
    this.calls.push(`reconnect ${id}`);
    this.devices = this.devices.map((d) => (d.id === id ? { ...d, state: "connected" } : d));
    this.settle();
  }
  /** Test control: a device connects, in order. */
  add(id: string, name: string, measures: readonly Measure[], readings: SensorDevice["readings"] = {}, state: SensorDevice["state"] = "connected"): this {
    this.devices = [...this.devices, { id, name, state, measures, readings }];
    this.settle();
    return this;
  }
  /** Test control: a reading arrives. */
  read(id: string, m: Measure, value: number, at: number): this {
    this.devices = this.devices.map((d) => (d.id === id ? { ...d, readings: { ...d.readings, [m]: { value, at } } } : d));
    this.changed();
    return this;
  }
  lose(id: string): this {
    this.devices = this.devices.map((d) => (d.id === id ? { ...d, state: "lost" } : d));
    this.settle();
    return this;
  }
  private settle(): void {
    if (this.state !== "choosing") this.state = this.devices.some((d) => d.state === "lost") ? "lost" : this.devices.length > 0 ? "connected" : "idle";
    this.changed();
  }
  /** Test control: set the snapshot's parts at once (the screenshot harness drives it from the page). */
  set(p: Partial<SourceSnapshot>): void {
    Object.assign(this, p);
    this.changed();
  }
}
