// What the room screen's control band holds (room-2d.md, "What is on it", "End, and its guard",
// "The class code"). Pure: from the clock's state, the band's routes and the phone remote's slot.
// Words are always words; the main button's word is the clock's state, never the press.
import type { BandRoute, BandRoutes } from "./band-routes.ts";
import { controlAddress } from "./remote.ts";
import type { RemoteView } from "./remote.ts";

export type ButtonId = "previous" | "main" | "next" | "remote" | "end" | "close" | "end-class" | "keep-going";

export interface ButtonView {
  readonly id: ButtonId;
  readonly word: string;
  /** The second line: where the press goes. */
  readonly sub: string | null;
  readonly disabled: boolean;
}

/** The class code: the riders' join code only, its QR address (when the site is known) and one state line. */
export interface CodeView {
  readonly code: string;
  readonly line: string;
  readonly address: string | null;
}

export type BandView =
  | { readonly mode: "buttons"; readonly transport: readonly ButtonView[]; readonly remote: ButtonView | null; readonly code: CodeView | null; readonly end: ButtonView }
  | { readonly mode: "ask"; readonly question: string; readonly endClass: ButtonView; readonly keepGoing: ButtonView }
  | { readonly mode: "finished"; readonly close: ButtonView };

export type ClockStatus = "ready" | "running" | "paused" | "ended";

const button = (id: ButtonId, word: string, sub: string | null = null, disabled = false): ButtonView => ({ id, word, sub, disabled });

/** "Start" before the start, "Pause" while running (or holding at a song change), "Resume" while paused. */
export function mainWord(status: ClockStatus): "Start" | "Pause" | "Resume" {
  return status === "ready" ? "Start" : status === "paused" ? "Resume" : "Pause";
}

/** The command the main button (and Space) sends in this state; none on "Class Complete". */
export function mainCommand(status: ClockStatus): "start" | "pause" | "resume" | null {
  return status === "ready" ? "start" : status === "running" ? "pause" : status === "paused" ? "resume" : null;
}

export const STOPS_FOLLOWING = "Stops following";

/** Next names the song when the music app is asked; Previous and Next name the interval on the clock. */
const stepSub = (r: BandRoute): string => (r === "handover" ? STOPS_FOLLOWING : r === "music" ? "Song" : "Interval");
/** The main button says nothing more unless its press hands the clock over. */
const mainSub = (r: BandRoute): string | null => (r === "handover" ? STOPS_FOLLOWING : null);

const ALL_CLOCK: BandRoutes = { start: "clock", pause: "clock", resume: "clock", next: "clock", previous: "clock" };

/** The phone remote's state line: at most 18 characters, nothing about the phones but how many. */
function codeLine(v: Extract<RemoteView, { slot: "on" }>): string {
  if (v.reconnecting) return "Reconnecting";
  return v.phones === 0 ? "Phone remote on" : v.phones === 1 ? "Phone connected" : "2 phones connected";
}

const REMOTE_SUB = { none: "Show the class code", in_use: "In use elsewhere", unreachable: "Can't reach site", ended: "Phone remote ended" } as const;

export function bandView(status: ClockStatus, routes: BandRoutes | null, remote: RemoteView, asking: boolean): BandView {
  if (status === "ended") return { mode: "finished", close: button("close", "Close class", "Back to the class list") };
  if (asking) return { mode: "ask", question: "End the class?", endClass: button("end-class", "End class", "Back to the class list"), keepGoing: button("keep-going", "Keep going") };
  const r = routes ?? ALL_CLOCK;
  const cmd = mainCommand(status) ?? "start";
  const transport = [button("previous", "Previous", stepSub(r.previous)), button("main", mainWord(status), mainSub(r[cmd])), button("next", "Next", stepSub(r.next))];
  let remoteButton: ButtonView | null = null;
  let code: CodeView | null = null;
  if (remote.slot === "available") remoteButton = button("remote", "Phone remote", REMOTE_SUB[remote.note]);
  else if (remote.slot === "starting") remoteButton = button("remote", "Phone remote", "Getting a code", true);
  else if (remote.slot === "on") code = { code: remote.joinCode, line: codeLine(remote), address: remote.site ? controlAddress(remote.site, remote.joinCode) : null };
  return { mode: "buttons", transport, remote: remoteButton, code, end: button("end", "End") };
}
