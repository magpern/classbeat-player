// What the rider's phone shows for a live session at a moment (docs/design/rider.md, "Content",
// "In the class" and "Ending"). Pure: no DOM, no I/O. The join form has its own model (join.ts).
// Only this rider's class view: the zone, the countdown, the effort from the rider's own numbers,
// position, the next intervals and the class time. Nothing about any other rider (rules 6, 13, 15).
import { clockText, countdownText } from "../../room/format.ts";
import { effortFor } from "./effort-calc.ts";
import type { Effort, MyNumbers } from "./effort-calc.ts";
import { countdownGone, hostAway, isLive, runSince } from "./session.ts";
import type { Live } from "./session.ts";
import type { RiderState } from "./wire.ts";

export const WAITING = "Waiting for the instructor";
export const RECONNECTING = "Reconnecting";

export interface TopView {
  /** A plate that takes the nickname's place: "Waiting for the instructor" or "Reconnecting". */
  readonly alert: string | null;
  readonly who: string;
  readonly time: string;
  readonly timeLabel: "left" | "class" | "ridden";
}

export type GelView =
  | { readonly blank: false; readonly zone: number; readonly name: string; readonly down: boolean; readonly label: string }
  | { readonly blank: true; readonly name: string; readonly sub: string };

export interface ClockView {
  readonly time: string;
  readonly label: string;
  /** Dimmed with a dashed rule: not live. */
  readonly est: boolean;
  readonly pill: string | null;
  /** "Seated" or "Standing"; null: no position block. */
  readonly position: string | null;
}

export type NextRow = readonly [zone: number, name: string, length: string];

export interface RunView {
  readonly kind: "run";
  readonly top: TopView;
  readonly gel: GelView;
  /** Null once the phone has been off the connection for more than 10 s, and when the class is complete. */
  readonly clock: ClockView | null;
  /** Null when the class is complete. */
  readonly effort: Effort | null;
  readonly coming: readonly NextRow[] | null;
  /** The class is complete: "Thank you for riding.", no key. */
  readonly done: boolean;
}

export type LiveView =
  | { readonly kind: "joining" }
  /** Joined, no class to show yet; `down`: the phone's own connection dropped meanwhile. */
  | { readonly kind: "waiting"; readonly who: string; readonly down: boolean }
  | { readonly kind: "removed" }
  | { readonly kind: "ended" }
  | { readonly kind: "lapsed" }
  | RunView;

/** "Joined as Anna"; after a reload the nickname is not known (it is never stored): "Joined". */
export const whoWords = (nickname: string | null): string => (nickname ? `Joined as ${nickname}` : "Joined");

const POSITION_WORDS = { seated: "Seated", standing: "Standing" } as const;

function clockLabel(s: RiderState, live: boolean): string {
  if (s.status === "not_started") return "First interval";
  if (s.status === "holding") return "Until the next song";
  if (!live) return "Interval left, not live";
  return s.next.length === 0 ? "Last interval" : "Interval left";
}

function gelLabel(s: RiderState): string {
  if (s.now.test) return `FTP test, ${s.now.test.minutes} min`;
  return s.status === "not_started" ? "First zone" : "";
}

function top(l: Live, s: RiderState, who: string, classLeft: number): TopView {
  const alert = hostAway(l) ? WAITING : l.conn !== "open" || !l.welcomed ? RECONNECTING : null;
  if (s.status === "not_started") return { alert, who, time: clockText(s.lengthMs), timeLabel: "class" };
  if (s.status === "ended") return { alert, who, time: clockText(s.lengthMs), timeLabel: "ridden" };
  return { alert, who, time: clockText(classLeft), timeLabel: "left" };
}

/** The class view, or the page that stands in for it. */
export function liveView(l: Live, at: number, nickname: string | null, mine: MyNumbers): LiveView {
  if (l.gone) return { kind: l.gone };
  const who = whoWords(nickname);
  const s = l.state;
  if (!s) return l.joined ? { kind: "waiting", who, down: l.conn !== "open" || !l.welcomed } : { kind: "joining" };
  const ran = runSince(l, at);
  const t = top(l, s, who, Math.max(0, s.classRemainingMs - ran));
  if (s.status === "ended") {
    return { kind: "run", top: t, gel: { blank: true, name: "Class complete", sub: `${clockText(s.lengthMs)} ridden` }, clock: null, effort: null, coming: null, done: true };
  }
  const live = isLive(l, at);
  const away = hostAway(l);
  const down = s.status === "paused" || s.status === "not_started" || away;
  const gel: GelView = { blank: false, zone: s.now.zone.number, name: s.now.zone.name, down, label: gelLabel(s) };
  const clock: ClockView | null = countdownGone(l, at)
    ? null
    : {
        time: countdownText(Math.max(0, s.now.remainingMs - ran)),
        label: clockLabel(s, live),
        est: !live,
        pill: s.status === "paused" ? "Paused" : null,
        position: s.now.position ? POSITION_WORDS[s.now.position] : null,
      };
  const coming = s.next.map((n): NextRow => [n.zone.number, n.zone.name, clockText(n.lengthMs)]);
  return { kind: "run", top: t, gel, clock, effort: effortFor(s.now.zone.effort, mine), coming, done: false };
}
