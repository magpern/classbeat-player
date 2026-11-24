// The rider's sensor source (ADR 0012, section 3): what the rider page asks of a sensor, and what it
// hears back. The page gets one from its entry point: the web page passes the browser's source, the
// native app the unavailable one, so the app bundles never carry the browser's sensor code.
import type { SensorEvent } from "./core/readings.ts";

export interface SensorSource {
  /** This browser can connect to a sensor. */
  readonly supported: boolean;
  /** The second line of the "Could not connect" plate. */
  readonly failDetail: string;
  /** The clock the events' times are on. */
  now(): number;
  /** Opens the browser's list of sensors; only on a press. */
  connect(): void;
  reconnect(id: string): void;
  disconnect(id: string): void;
  disconnectAll(): void;
  /** Hears every event; returns the way to stop. */
  listen(cb: (e: SensorEvent) => void): () => void;
}

/** A source that cannot connect: the native app, and browsers without the API. */
export function unavailableSource(): SensorSource {
  return {
    supported: false,
    failDetail: "",
    now: () => 0,
    connect: () => {},
    reconnect: () => {},
    disconnect: () => {},
    disconnectAll: () => {},
    listen: () => () => {},
  };
}

/** Calls each listener; a listener that throws does not stop the others. */
export class Listeners {
  private readonly all = new Set<(e: SensorEvent) => void>();
  add(cb: (e: SensorEvent) => void): () => void {
    this.all.add(cb);
    return () => this.all.delete(cb);
  }
  emit(e: SensorEvent): void {
    for (const cb of [...this.all]) cb(e);
  }
}
