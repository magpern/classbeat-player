// The companion's fixed words (docs/design/companion.md, "Wording"; ADR 0005 section 5). Pure.
// No free text crosses the relay: every word the page shows beyond the class's own (zone names,
// cues, song titles) is written here, from the contract's enums.
import type { CompanionState } from "./state-check.ts";
import type { AckReason } from "./wire.ts";
import type { Flash, Pending } from "./session.ts";

type Link = CompanionState["link"];
type Announcement = NonNullable<Link["announcement"]>;

export interface LinkWords {
  readonly text: string;
  /** "plate": a white plate (something is not as usual); "manual": grey with a square; "": quiet grey. */
  readonly kind: "" | "manual" | "alert";
}

/** The room screen's words for the music link (companion.md, "Link words"). */
export function linkWords(l: Link): LinkWords {
  if (l.mode === "manual") return { text: "Manual clock", kind: "manual" };
  switch (l.state) {
    case "locked":
      return { text: "Following the music", kind: "" };
    case "paused":
      return { text: "Music paused", kind: "alert" };
    case "coasting":
      return { text: "Music not heard", kind: "alert" };
    case "off_the_list":
      return { text: "Not a class song", kind: "alert" };
    case "ambiguous":
      return { text: "Song is in twice", kind: "alert" };
    case "manual":
      return { text: "Manual clock", kind: "manual" };
  }
}

/** The clock runs on by itself: the countdown and the song change are estimates. */
export const isEstimated = (l: Link): boolean => l.mode === "following" && (l.state === "coasting" || l.state === "off_the_list");

/** Seconds as "30 s", or as "M:SS" from a minute. */
export function secondsWords(s: number): string {
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface NoticeWords {
  readonly head: string;
  readonly detail: string;
}

/** The resync announcement as the page writes it from `kind` and `seconds`. */
export function announcementWords(a: Announcement, canUndo: boolean): NoticeWords {
  if (a.kind === "following_stopped") return { head: "Following stopped: manual clock", detail: canUndo ? "Undo goes back to where the clock was." : "" };
  const way = a.kind === "resynced_back" ? "back" : "forward";
  return { head: `Resynced, ${secondsWords(a.seconds ?? 0)} ${way}`, detail: canUndo ? "Undo goes back and stops following." : "" };
}

export const NOT_WHILE_FOLLOWING = "Not while following the music: use the computer";
export const TOO_LATE = "Too late, try again";
export const NOT_CONNECTED = "Not connected";
export const NO_ANSWER = "No answer. Check the class.";

/** ADR 0005 section 5's words for every refusal reason of `ack`. */
export const REFUSAL_WORDS: Readonly<Record<AckReason, string>> = {
  would_stop_following: NOT_WHILE_FOLLOWING,
  not_allowed: NOT_WHILE_FOLLOWING,
  stale: TOO_LATE,
  stale_run: TOO_LATE,
  invalid: TOO_LATE,
  rate: TOO_LATE,
  host_away: NOT_CONNECTED,
};

/** The notice's head in skip's place, for a refusal or no answer. */
export function flashNotice(f: Flash): string {
  if (f.kind === "refused") return REFUSAL_WORDS[f.reason];
  return NO_ANSWER;
}

/** The short note in the top line after an applied command. */
export function doneWords(p: Pending, s: CompanionState): string {
  switch (p.action) {
    case "start":
      return "Started";
    case "pause":
      return "Paused";
    case "resume":
      return "Resumed";
    case "nudge":
      return p.deltaMs === -5000 ? "Back 5 s" : "Forward 5 s";
    case "undo_resync":
      return "Undone: manual clock";
    case "skip":
      return p.skipTo === "song" ? "Next song" : `Next interval: ${s.now.zone.number} ${s.now.zone.name}`;
  }
}
