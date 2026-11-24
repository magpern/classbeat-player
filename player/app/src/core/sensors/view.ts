// What the instructor's sensor panel shows (docs/design/sensors.md, part 2). Pure: from a source's
// snapshot, the open class's current interval and the instructor's two numbers. It reads; it
// returns a view and nothing else, so no reading can reach the clock, the timing, a target or the
// music link (ADR 0012 section 4, rules 3, 5, 7, 8, 11).
import { fresh } from "../../../../../web/src/sensors/core/index.ts";
import type { Interval, ZoneDef } from "../../../../../schema/generated/ts/class.d.ts";
import { gauge } from "./gauge-calc.ts";
import type { Gauge } from "./gauge-calc.ts";
import { planFor } from "./plan.ts";
import type { Numbers } from "./plan.ts";
import type { Values } from "./shown.ts";
import { LABEL, measuresWords, planLine, SERVICE_WORDS, TEXT, UNIT, failedLine } from "./strings.ts";
import { MEASURES } from "./types.ts";
import type { Measure, SensorDevice, SourceSnapshot } from "./types.ts";

export interface MeasureView {
  readonly measure: Measure;
  readonly label: string;
  readonly unit: string;
  /** The shown number, or null for the dash. */
  readonly value: number | null;
  /** The device in use for this measure is lost: a dash and the plate. */
  readonly lost: boolean;
  readonly plan: string;
  readonly gauge: Gauge | null;
  /** The zone the band stands for (the only hue), or null. */
  readonly zone: number | null;
  /** The gauge's text alternative, which reads like the row. */
  readonly alt: string;
}

export interface DeviceView {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly lost: boolean;
  readonly action: "Disconnect" | "Reconnect";
  readonly canReconnect: boolean;
}

export interface SensorsView {
  /** The word in the head: "Not available yet", "Nothing connected", "Connected", "Sensor lost", "Choosing…". */
  readonly state: string;
  readonly unavailable: boolean;
  readonly line: string | null;
  readonly canConnect: boolean;
  readonly canOpen: boolean;
  readonly measures: readonly MeasureView[];
  readonly devices: readonly DeviceView[];
  readonly choosing: boolean;
  readonly nearby: readonly { readonly id: string; readonly name: string; readonly service: string }[];
  readonly failure: string | null;
  /** Says where to type the two numbers, when a plan is only a percentage. */
  readonly noNumbers: string | null;
}

export interface PlanInput {
  readonly interval: Interval | null;
  readonly zone: ZoneDef | null;
}

/** The device in use for a measure: the one connected first, lost or not (no silent switch). */
export function usedDevice(devices: readonly SensorDevice[], m: Measure): SensorDevice | null {
  return devices.find((d) => d.measures.includes(m)) ?? null;
}

/** Each measure's reading at `now`, before the once-a-second step: null when missing, lost or no device. */
export function freshValues(s: SourceSnapshot, now: number): Values {
  const v = (m: Measure): number | null => {
    const d = usedDevice(s.devices, m);
    return d && d.state === "connected" ? fresh(d.readings[m], now) : null;
  };
  return { heartRate: v("heartRate"), power: v("power"), cadence: v("cadence") };
}

function measureView(m: Measure, s: SourceSnapshot, shown: Values, p: PlanInput, n: Numbers): MeasureView {
  const d = usedDevice(s.devices, m);
  const lost = d !== null && d.state === "lost";
  const value = lost ? null : shown[m];
  const plan = planFor(m, p.interval, p.zone, n);
  const g = plan.range ? gauge(plan.range, value) : null;
  const read = value === null ? `${LABEL[m]}, ${lost ? TEXT.lost.toLowerCase() : TEXT.noReading}` : `${LABEL[m]} ${value} ${UNIT[m]}`;
  return { measure: m, label: LABEL[m], unit: UNIT[m], value, lost, plan: planLine(plan.text), gauge: g, zone: plan.zone, alt: plan.range ? `${read}, plan ${plan.range[0]} to ${plan.range[1]}` : read };
}

function deviceView(d: SensorDevice, s: SourceSnapshot, shown: Values): DeviceView {
  const lost = d.state === "lost";
  const unused = !lost && d.measures.every((m) => usedDevice(s.devices, m) !== d);
  const noReading = !lost && !unused && d.measures.every((m) => shown[m] === null);
  const state = lost ? `${measuresWords(d.measures)}, lost` : unused ? TEXT.notUsed : `${measuresWords(d.measures)}, ${noReading ? TEXT.noReading : "connected"}`;
  return { id: d.id, name: d.name, state, lost, action: lost ? "Reconnect" : "Disconnect", canReconnect: lost };
}

export function buildView(s: SourceSnapshot, shown: Values, p: PlanInput, n: Numbers): SensorsView {
  const unavailable = s.state === "unavailable";
  const measures = unavailable ? [] : MEASURES.filter((m) => usedDevice(s.devices, m) !== null).map((m) => measureView(m, s, shown, p, n));
  const word = { unavailable: TEXT.unavailable, idle: TEXT.idle, choosing: TEXT.choosing, connected: TEXT.connected, lost: TEXT.lost }[s.state];
  return {
    state: word,
    unavailable,
    line: unavailable ? TEXT.unavailableLine : null,
    canConnect: s.state === "idle",
    canOpen: !unavailable && s.devices.length > 0,
    measures,
    devices: s.devices.map((d) => deviceView(d, s, shown)),
    choosing: s.state === "choosing",
    // Nothing is listed that offers no allowed service.
    nearby: s.nearby.filter((d) => d.services.length > 0).map((d) => ({ id: d.id, name: d.name, service: d.services.map((k) => SERVICE_WORDS[k]).join(", ") })),
    failure: s.failed === null ? null : failedLine(s.failed),
    noNumbers: planNeedsNumbers(p, n, measures) ? TEXT.noNumbers : null,
  };
}

function planNeedsNumbers(p: PlanInput, n: Numbers, shown: readonly MeasureView[]): boolean {
  return shown.some((m) => planFor(m.measure, p.interval, p.zone, n).needsNumber);
}
