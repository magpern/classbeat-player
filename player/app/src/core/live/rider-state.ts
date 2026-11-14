// rider_state (ADR 0007 section 2): what a rider's phone shows, built from the clock snapshot and
// the class only. Pure. The input type has no rider field of any kind, so nothing from a rider can
// reach the message; it holds no cue, no song and no link state, only the zones as the class gives
// them. The same message goes to every rider.
import type { Class, Range, ZoneDef } from "../../../../../schema/generated/ts/class.d.ts";
import type { RiderComingInterval, RiderState, RiderZone } from "../../../../../schema/generated/ts/live-rider-state.d.ts";
import type { ClockView } from "../clock/view.ts";
import type { LinkView } from "../link/view.ts";

const DAY_MS = 86_400_000;
const MAX_ZONE_NAME = 80;
const MAX_RANGE = 1000;
export const MAX_RIDER_NEXT = 3;

/** The class, the clock's view and the hold the link reports at the class end: nothing else. */
export interface RiderInput {
  readonly doc: Class;
  readonly view: ClockView;
  readonly link: Pick<LinkView, "held" | "holdRemainingMs" | "classRemainingMs">;
}

const clip = (s: string, n: number): string => Array.from(s).slice(0, n).join("");
const ms = (v: number): number => Math.min(DAY_MS, Math.max(0, Math.round(v)));
const pct = (v: number): number => Math.min(MAX_RANGE, Math.max(0, Math.round(v)));
const rangeOf = (r: Range | undefined): [number, number] | null => (r === undefined ? null : [pct(r[0]), pct(r[1])]);

function zoneOf(doc: Class, zone: number): RiderZone {
  const def: ZoneDef | undefined = doc.zone_scale.find((z) => z.zone === zone);
  const name = def ? clip(def.name, MAX_ZONE_NAME) : "";
  return {
    number: zone,
    name: name.length > 0 ? name : `Zone ${zone}`,
    effort: { ftpPct: rangeOf(def?.ftp_pct), hrmaxPct: rangeOf(def?.hrmax_pct), rpe: rangeOf(def?.rpe) },
  };
}

/** The state message for run `run` and its own counter `seq`. */
export function riderStateOf(input: RiderInput, run: string, seq: number): RiderState {
  const { doc, view, link } = input;
  const iv = doc.intervals[view.intervalIndex];
  const next: RiderComingInterval[] = doc.intervals.slice(view.intervalIndex + 1, view.intervalIndex + 1 + MAX_RIDER_NEXT).map((c) => ({
    startMs: ms(c.start_ms),
    lengthMs: Math.max(1, ms(c.length_ms)),
    zone: zoneOf(doc, c.zone),
    position: c.position ?? null,
  }));
  const holding = link.held && view.status !== "ended";
  const status: RiderState["status"] = view.status === "ended" ? "ended" : holding ? "holding" : view.status === "ready" ? "not_started" : view.status;
  return {
    v: 1,
    type: "rider_state",
    run,
    seq,
    status,
    classMs: ms(view.classMs),
    lengthMs: Math.max(1, ms(view.lengthMs)),
    classRemainingMs: ms(link.classRemainingMs),
    now: {
      index: view.intervalIndex,
      zone: zoneOf(doc, iv.zone),
      position: iv.position ?? null,
      test: iv.test === undefined ? null : { kind: "ftp", minutes: iv.test.minutes },
      remainingMs: ms(holding && link.holdRemainingMs !== null ? link.holdRemainingMs : view.intervalRemainingMs),
    },
    next: next as RiderState["next"],
  };
}
