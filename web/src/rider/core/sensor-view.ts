// sensor_view: what the rider's class view shows of the rider's own sensors (docs/design/sensors.md,
// part 1): one row per measure with the plan beside the reading and its gauge, a plate, a line,
// and the second key of the foot row. Pure: the sensors' state and the shown readings in, the view
// out. The words state facts and never say what to do (rules 8 and 11); a reading never takes a
// colour, only the planned band stands for the zone (rule 7).
import { gauge } from "../../sensors/core/gauge-calc.ts";
import type { Gauge } from "../../sensors/core/gauge-calc.ts";
import { measureNow, sourceState, usedFor } from "../../sensors/core/readings.ts";
import type { Measure, Sensors } from "../../sensors/core/readings.ts";
import { RUN_LABELS, RUN_MEASURES, RUN_UNITS, runText, usedForRun } from "../../sensors/core/run-readings.ts";
import type { RunMeasure } from "../../sensors/core/running.ts";
import { HINT } from "./effort-calc.ts";
import type { Effort, EffortRow } from "./effort-calc.ts";

export type SensorAction = "sensors" | "reconnect_sensor";

export interface SensorKey {
  readonly action: SensorAction;
  readonly label: string;
  readonly dis: boolean;
}

export interface Reading {
  /** Null: no value (a grey dash). */
  readonly value: number | null;
  readonly unit: string;
  /** "plan": a gauge against the plan; "none": the plan is in another unit (a hidden placeholder); "solo": no plan. */
  readonly gauge: Gauge | "none" | "solo";
  /** The gauge's text alternative, as the row reads. */
  readonly aria: string;
}

export interface MeasureRow {
  readonly label: string;
  /** The planned value and its unit; null: no plan (cadence). */
  readonly plan: { readonly value: string; readonly unit: string } | null;
  /** Null: no sensor gives this measure. */
  readonly read: Reading | null;
}

/**
 * A treadmill or foot-pod reading (ADR 0015 section 4): a label, a number and its unit, nothing more.
 * No gauge and no plan beside it, and no colour by value (rules 7 and 8).
 */
export interface RunRow {
  readonly label: string;
  /** The number as shown ("9.5", "164"), or "–" when it has no value. */
  readonly text: string;
  readonly unit: string;
  /** The row as read aloud. */
  readonly aria: string;
}

export interface SensorBlock {
  readonly rows: readonly MeasureRow[];
  /** After the effort rows: only the measures a connected sensor gives. */
  readonly runs: readonly RunRow[];
  readonly plate: { readonly head: string; readonly detail: string } | null;
  readonly hint: string | null;
}

export interface SensorView {
  /** Null: no sensor and nothing to say; the effort is drawn as before. */
  readonly block: SensorBlock | null;
  readonly key: SensorKey;
}

/** The readings as shown: each measure's value after the once-a-second step. */
export type Shown = Readonly<Partial<Record<Measure, number | null>>>;
export type RunShown = Readonly<Partial<Record<RunMeasure, number | null>>>;

export const PLATES = {
  choosing: ["Choose your sensor", "Pick it in your browser’s list."],
  lost: ["Sensor lost", "Wake it, then press Reconnect."],
  failed: ["Could not connect", ""],
} as const;

const UNITS: Readonly<Record<Measure, string>> = { power: "W", hr: "bpm", cadence: "rpm" };
const LABELS: Readonly<Record<Measure, EffortRow["label"] | "Cadence">> = { power: "Power", hr: "Heart rate", cadence: "Cadence" };
const MISSING: Readonly<Record<Measure, string>> = { hr: "No heart rate from your strap.", power: "No power from your bike.", cadence: "No cadence from your bike." };
const NUMBER: Readonly<Record<"power" | "hr", string>> = { power: "FTP", hr: "max heart rate" };

/** The line that says where to give the number a gauge needs. */
export function numbersHint(need: readonly ("power" | "hr")[]): string {
  return `Add your ${need.map((m) => NUMBER[m]).join(" and ")} in My numbers to see the gauge.`;
}

export function sensorKey(s: Sensors, supported: boolean): SensorKey {
  switch (sourceState(s, supported)) {
    case "choosing":
      return { action: "sensors", label: "Choosing…", dis: true };
    case "lost":
      return { action: "reconnect_sensor", label: "Reconnect", dis: false };
    case "connected":
      return { action: "sensors", label: "Sensors", dis: false };
    default:
      return { action: "sensors", label: "Connect a sensor", dis: false };
  }
}

function reading(m: Measure, row: EffortRow | undefined, value: number | null): Reading {
  const said = value === null ? "no reading" : `${value} ${UNITS[m]}`;
  const plan = row?.range ? `, plan ${row.range[0]} to ${row.range[1]}` : "";
  const g = row ? (row.range ? gauge(row.range, value) : "none") : "solo";
  return { value, unit: UNITS[m], gauge: g, aria: `${LABELS[m]} ${said}${plan}` };
}

function plateOf(s: Sensors, failDetail: string): SensorBlock["plate"] {
  if (s.choosing) return { head: PLATES.choosing[0], detail: PLATES.choosing[1] };
  const lost = s.devices.find((d) => d.lost);
  if (lost) return { head: PLATES.lost[0], detail: `${lost.name}. ${PLATES.lost[1]}` };
  if (s.failed) return { head: PLATES.failed[0], detail: failDetail };
  return null;
}

function runRows(s: Sensors, shown: RunShown): RunRow[] {
  return RUN_MEASURES.filter((m) => usedForRun(s, m) !== null).map((m) => {
    const text = runText(m, shown[m] ?? null);
    return { label: RUN_LABELS[m], text, unit: RUN_UNITS[m], aria: `${RUN_LABELS[m]} ${text === "–" ? "no reading" : `${text} ${RUN_UNITS[m]}`}` };
  });
}

/** The effort with the rider's readings: power, heart rate and cadence as they come, then RPE, then a treadmill's or foot pod's. */
export function sensorView(effort: Effort | null, s: Sensors, shown: Shown, now: number, supported: boolean, failDetail: string, runShown: RunShown = {}): SensorView {
  const key = sensorKey(s, supported);
  if (!effort || !supported || (!s.devices.length && !s.choosing && !s.failed)) return { block: null, key };
  const rows: MeasureRow[] = [];
  const missing: string[] = [];
  const need: ("power" | "hr")[] = [];
  for (const m of ["power", "hr", "cadence"] as const) {
    const plan = effort.rows.find((r) => r.label === LABELS[m]);
    const used = usedFor(s, m) !== null;
    if (!plan && !used) continue;
    const read = used ? reading(m, plan, shown[m] ?? null) : null;
    rows.push({ label: LABELS[m], plan: plan ? { value: plan.value, unit: plan.unit } : null, read });
    if (used && measureNow(s, m, now).missing) missing.push(MISSING[m]);
    if (m !== "cadence" && used && read?.gauge === "none") need.push(m);
  }
  for (const r of effort.rows.filter((r) => r.label === "RPE")) rows.push({ label: r.label, plan: { value: r.value, unit: r.unit }, read: null });
  const hint = missing[0] ?? (need.length ? numbersHint(need) : effort.hint ? HINT : null);
  return { block: { rows, runs: runRows(s, runShown), plate: plateOf(s, failDetail), hint }, key };
}

/** The once-a-second step: a number replaces another only a second after the last change; a dash at once. */
export function stepShown(before: { readonly value: number | null; readonly at: number } | undefined, value: number | null, now: number): { readonly value: number | null; readonly at: number } {
  if (before && before.value === value) return before;
  if (before && before.value !== null && value !== null && now - before.at < 1000) return before;
  return { value, at: now };
}
