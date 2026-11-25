// The rider's own sensors on the rider page (docs/design/sensors.md, ADR 0012): it holds the source
// the entry point gave, the sensors' state, the readings as shown and which sheet is open. Readings
// live only here, in memory: nothing stores them and nothing sends them (rules 4 and 6). The sensor
// is only ever connected on a press, never again by itself.
import { deviceWords, MEASURES, measureNow, NO_SENSORS, step } from "../sensors/core/readings.ts";
import type { Measure, Sensors } from "../sensors/core/readings.ts";
import { RUN_MEASURES, runNow } from "../sensors/core/run-readings.ts";
import type { RunMeasure } from "../sensors/core/running.ts";
import { isIphone } from "../sensors/core/platform.ts";
import type { Agent } from "../sensors/core/platform.ts";
import type { SensorSource } from "../sensors/source.ts";
import type { Effort } from "./core/effort-calc.ts";
import { sensorView, stepShown } from "./core/sensor-view.ts";
import type { RunShown, SensorView, Shown } from "./core/sensor-view.ts";
import { sensorsSheet, unsupportedSheet } from "./render/sensors.ts";

type SensorSheet = "none" | "sensors" | "unsupported";

export class SensorPanel {
  private s: Sensors = NO_SENSORS;
  private shown = new Map<Measure, { readonly value: number | null; readonly at: number }>();
  private runShown = new Map<RunMeasure, { readonly value: number | null; readonly at: number }>();
  private open: SensorSheet = "none";
  private readonly unlisten: () => void;
  private readonly source: SensorSource;
  private readonly changed: () => void;
  private readonly agent: Agent;

  constructor(source: SensorSource, changed: () => void, agent: Agent = navigator) {
    this.source = source;
    this.changed = changed;
    this.agent = agent;
    this.unlisten = source.listen((e) => {
      this.s = step(this.s, e);
      this.changed();
    });
  }

  /** The second key of the foot row. */
  press(): void {
    if (!this.source.supported) return this.show("unsupported");
    if (this.s.choosing) return;
    if (this.s.devices.some((d) => d.lost)) {
      for (const d of this.s.devices.filter((x) => x.lost)) this.source.reconnect(d.id);
      return;
    }
    if (this.s.devices.length) return this.show("sensors");
    this.source.connect();
  }

  /** What the class view shows: the readings stepped once a second, a dash at once. */
  view(effort: Effort | null): SensorView {
    const now = this.source.now();
    const shown: Partial<Record<Measure, number | null>> = {};
    for (const m of MEASURES) {
      const v = measureNow(this.s, m, now).value;
      const next = stepShown(this.shown.get(m), v, now);
      this.shown.set(m, next);
      shown[m] = next.value;
    }
    const runs: Partial<Record<RunMeasure, number | null>> = {};
    for (const m of RUN_MEASURES) {
      const next = stepShown(this.runShown.get(m), runNow(this.s, m, now).value, now);
      this.runShown.set(m, next);
      runs[m] = next.value;
    }
    return sensorView(effort, this.s, shown as Shown, now, this.source.supported, this.source.failDetail, runs as RunShown);
  }

  /** The open sheet: a key that changes when what it shows changes, and its page. Null: none open. */
  sheet(): { readonly key: string; readonly build: () => HTMLElement } | null {
    if (this.open === "unsupported") return { key: "sensors:unsupported", build: () => unsupportedSheet(isIphone(this.agent), () => this.show("none")) };
    if (this.open !== "sensors") return null;
    if (!this.s.devices.length) {
      this.open = "none";
      return null;
    }
    const rows = this.s.devices.map((d) => ({ id: d.id, name: d.name, words: deviceWords(this.s, d), lost: d.lost }));
    const build = (): HTMLElement =>
      sensorsSheet(rows, {
        disconnect: (id) => this.source.disconnect(id),
        reconnect: (id) => this.source.reconnect(id),
        add: () => {
          this.show("none");
          this.source.connect();
        },
        done: () => this.show("none"),
      });
    return { key: `sensors:${JSON.stringify(rows)}`, build };
  }

  /** Closes a sheet; true if one was open (the native back key). */
  close(): boolean {
    if (this.open === "none") return false;
    this.show("none");
    return true;
  }

  /** The class ended or the rider left: every sensor is let go, and nothing reconnects. */
  stop(): void {
    this.open = "none";
    this.source.disconnectAll();
  }

  /** The page is gone for good. */
  dispose(): void {
    this.stop();
    this.unlisten();
  }

  private show(sheet: SensorSheet): void {
    this.open = sheet;
    this.changed();
  }
}
