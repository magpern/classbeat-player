// The instructor's sensor panel, its source and what a source holds (ADR 0012 sections 3, 4 and 6;
// docs/design/sensors.md, part 2). Types only: no Bluetooth, no I/O. A source is read, never
// told what a class does, and nothing in here names a way to control a bike (rule 2).
import type { Stamped } from "../../../../../web/src/sensors/core/index.ts";

export type Measure = "heartRate" | "power" | "cadence";
/** The order the row and the drawer show the measures in. */
export const MEASURES: readonly Measure[] = ["heartRate", "power", "cadence"];

/** The four allowed services (ADR 0012 section 1), by name. */
export type ServiceKey = "heartRate" | "cyclingSpeedCadence" | "cyclingPower" | "fitnessMachine";

export type SourceState = "unavailable" | "idle" | "choosing" | "connected" | "lost";

export interface SensorDevice {
  readonly id: string;
  /** The name the device gives; shown as text only. */
  readonly name: string;
  readonly state: "connected" | "lost";
  readonly measures: readonly Measure[];
  /** The latest whole-number reading per measure, stamped with the source's clock. */
  readonly readings: Readonly<Partial<Record<Measure, Stamped<number>>>>;
}

/** A device the app's own list offers; only devices with an allowed service are ever listed. */
export interface NearbyDevice {
  readonly id: string;
  readonly name: string;
  readonly services: readonly ServiceKey[];
}

export interface SourceSnapshot {
  readonly state: SourceState;
  /** Connected and lost devices, in the order they were connected. */
  readonly devices: readonly SensorDevice[];
  readonly nearby: readonly NearbyDevice[];
  /** The name of the device that refused the last connection, or null. */
  readonly failed: string | null;
}

/**
 * Where readings come from. `connect` is a person's tap and opens the list of nearby devices;
 * nothing is chosen, connected or reconnected except by a tap. Readings live in memory only.
 */
export interface SensorSource {
  snapshot(): SourceSnapshot;
  subscribe(listener: () => void): () => void;
  connect(): void;
  choose(id: string): void;
  cancel(): void;
  disconnect(id: string): void;
  reconnect(id: string): void;
}
