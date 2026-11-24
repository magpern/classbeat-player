// Every fixed string of the instructor's sensor panel (docs/design/sensors.md, "Wording"). No cue,
// no generated text, nothing that tells the instructor what to do (rules 8 and 10); a test over this
// catalogue keeps the spec's "Never" words out of it.
import type { Measure, ServiceKey } from "./types.ts";

export const LABEL: Readonly<Record<Measure, string>> = { heartRate: "Heart rate", power: "Power", cadence: "Cadence" };
export const UNIT: Readonly<Record<Measure, string>> = { heartRate: "bpm", power: "W", cadence: "rpm" };
export const SERVICE_WORDS: Readonly<Record<ServiceKey, string>> = {
  heartRate: "Heart rate",
  cyclingSpeedCadence: "Cycling speed and cadence",
  cyclingPower: "Cycling power",
  fitnessMachine: "Fitness machine",
};

export const TEXT = {
  title: "Sensors",
  unavailable: "Not available yet",
  unavailableLine: "Reading sensors on this computer is not set up yet.",
  idle: "Nothing connected",
  connected: "Connected",
  lost: "Sensor lost",
  choosing: "Choosing…",
  connect: "Connect a sensor",
  connectAnother: "Connect another sensor",
  show: "Show",
  hide: "Hide",
  disconnect: "Disconnect",
  reconnect: "Reconnect",
  cancel: "Cancel",
  choose: "Connect",
  looking: "Looking for sensors. Wake yours.",
  note: "Readings stay on this computer. Nothing is sent, saved or compared.",
  noNumbers: "Type your FTP and max heart rate below to see the gauge.",
  ftp: "Your FTP, in watts",
  hrmax: "Your max heart rate, in bpm",
  notUsed: "connected, not used",
  noReading: "no reading",
  noPlan: "No plan",
  missing: "–",
} as const;

export const failedLine = (name: string): string => `Could not connect to ${name}. Check that it is awake.`;
export const planLine = (text: string | null): string => (text === null ? TEXT.noPlan : `Plan ${text}`);

/** "Heart rate", "Power and cadence": the measures a device gives, in words. */
export function measuresWords(ms: readonly Measure[]): string {
  const w = ms.map((m, i) => (i === 0 ? LABEL[m] : LABEL[m].toLowerCase()));
  return w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}` : (w[0] ?? "");
}
