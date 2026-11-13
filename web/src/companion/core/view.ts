// What the phone shows for a live session at a moment (docs/design/companion.md, "Content" and
// "States"). Pure: no DOM, no I/O. The entry page has its own model (entry.ts).
import { clockText, countdownText } from "../../room/format.ts";
import { countsAt, lastSeenMs, liveness } from "./clock.ts";
import { keysModel } from "./keys.ts";
import type { KeysModel } from "./keys.ts";
import type { Live } from "./session.ts";
import type { CompanionState } from "./state-check.ts";
import { doneWords, isEstimated, linkWords } from "./words.ts";
import type { LinkWords } from "./words.ts";

export interface TopView {
  /** The link words, a plate, or the note after a press (which takes the link's place for 3 s). */
  readonly link: LinkWords | null;
  readonly note: string | null;
  readonly time: string;
  readonly timeLabel: string;
}

export type GelView =
  | { readonly blank: false; readonly zone: number; readonly name: string; readonly down: boolean; readonly label: string }
  | { readonly blank: true; readonly name: string; readonly sub: string };

export interface SongView {
  readonly label: string;
  readonly when: string;
  readonly dim: boolean;
  readonly title: string;
  readonly artist: string;
}

export interface ClockView {
  readonly time: string;
  readonly label: string;
  /** Dimmed with a dashed rule: estimated, or not live. */
  readonly est: boolean;
  readonly pill: string | null;
  /** The next song change, or null: "None left". */
  readonly song: SongView | null;
}

export interface RunView {
  readonly kind: "run";
  readonly top: TopView;
  readonly gel: GelView;
  readonly clock: ClockView | null;
  readonly cue: string | null;
  readonly coming: readonly (readonly [zone: number, name: string, length: string])[] | null;
  readonly keys: KeysModel;
}

export interface LostView {
  readonly kind: "lost";
  /** The phone's own connection is down (it tries again), or the computer is away. */
  readonly phone: boolean;
  readonly zone: { readonly number: number; readonly name: string } | null;
  readonly lastSeen: string;
}

export type LiveView = { readonly kind: "connecting" } | { readonly kind: "dropped" } | { readonly kind: "ended" } | LostView | RunView;

function top(l: Live, s: CompanionState, live: boolean, classRemainingMs: number): TopView {
  let link: LinkWords = linkWords(s.link);
  if (l.conn !== "open") link = { text: "Reconnecting", kind: "alert" };
  else if (!l.hostIn) link = { text: "Computer not connected", kind: "alert" };
  else if (s.status === "not_started") link = { text: "Not started", kind: "manual" };
  else if (s.status === "ended") link = { text: "Ended", kind: "manual" };
  const note = live && l.note?.kind === "done" ? doneWords(l.note.press, s) : null;
  if (s.status === "not_started") return { link, note, time: clockText(s.lengthMs), timeLabel: "class" };
  if (s.status === "ended") return { link, note: null, time: clockText(s.lengthMs), timeLabel: "ridden" };
  return { link, note, time: clockText(classRemainingMs), timeLabel: "left" };
}

function clockLabel(s: CompanionState, live: boolean): string {
  if (!live) return "Not live";
  if (s.status === "not_started") return "First interval";
  if (s.status === "holding") return "Until the next song";
  if (s.next.length === 0) return "Last interval";
  return isEstimated(s.link) ? "Interval left, estimated" : "Interval left";
}

function song(s: CompanionState, toSongMs: number | null): SongView | null {
  if (!s.nextSong || toSongMs === null) return null;
  const est = isEstimated(s.link);
  const first = s.status === "not_started";
  const when = first && toSongMs === 0 ? "at the start" : `in ${est ? "about " : ""}${clockText(toSongMs)}`;
  return { label: first ? "First song" : "Next song", when, dim: est, title: s.nextSong.title, artist: s.nextSong.artist };
}

function runView(l: Live, s: CompanionState, live: boolean, at: number): RunView {
  const c = countsAt(s, l.stateAt, at);
  const keys = keysModel(l, s, live);
  if (s.status === "ended") {
    return { kind: "run", top: top(l, s, live, c.classRemainingMs), gel: { blank: true, name: "Class complete", sub: `${clockText(s.lengthMs)} ridden` }, clock: null, cue: null, coming: null, keys };
  }
  const down = s.status === "paused" || s.status === "not_started";
  const gel: GelView = { blank: false, zone: s.now.zone.number, name: s.now.zone.name, down, label: s.status === "not_started" ? "First zone" : "" };
  const clock: ClockView = { time: countdownText(c.remainingMs), label: clockLabel(s, live), est: !live || isEstimated(s.link), pill: s.status === "paused" ? "Paused" : null, song: song(s, c.toSongMs) };
  const coming = s.next.map((n) => [n.zone.number, n.zone.name, clockText(n.lengthMs)] as const);
  return { kind: "run", top: top(l, s, live, c.classRemainingMs), gel, clock, cue: s.now.cue, coming, keys };
}

/** The live session's screen at time `at`. */
export function liveView(l: Live, at: number): LiveView {
  if (l.gone) return { kind: l.gone };
  const s = l.state;
  const how = liveness(l, at);
  if (!s) return l.conn === "down" || (l.welcomed && !l.hostIn) ? { kind: "lost", phone: l.conn !== "open", zone: null, lastSeen: "" } : { kind: "connecting" };
  if (how === "lost") return { kind: "lost", phone: l.conn !== "open", zone: { number: s.now.zone.number, name: s.now.zone.name }, lastSeen: clockText(lastSeenMs(l, at)) };
  return runView(l, s, how === "live", at);
}
