// Shared shapes of the music link (ADR 0001, "Music link: follow, never depend"). Pure: types and
// constants only. A reader only reports what the music app says; nothing here plays, fetches or
// stores audio (plan section 3, rule 3).

export type LinkStateName = "Locked" | "Paused" | "Coasting" | "Off the list" | "Ambiguous" | "Manual";

/** What a reader reports about the track the music app has loaded. */
export interface TrackInfo {
  readonly title: string;
  readonly artist: string;
  readonly lengthMs?: number | null;
  /** The provider's own id, only where the operating system gives one. */
  readonly trackId?: string | null;
}

/** One raw reading. Rule 8: it carries its own time. */
export interface Observation extends TrackInfo {
  /** The app the reading came from, when the system says (Windows). Not Spotify means off the list. */
  readonly app?: string | null;
  readonly positionMs: number;
  readonly playing: boolean;
  /** Monotonic time (ms) when the system last updated `positionMs`. */
  readonly at: number;
  /** Monotonic time when the reader got this reading; a quiet reader goes stale from here. */
  readonly seenAt: number;
}

export interface LinkSong {
  readonly index: number;
  readonly title: string;
  readonly artist: string;
  readonly lengthMs: number;
  readonly startMs: number;
  readonly endMs: number;
  /** Provider ids the class states for this recording (bare ids). */
  readonly trackIds: readonly string[];
}

export interface LinkPlan {
  readonly songs: readonly LinkSong[];
  readonly plannedCrossfadeMs: number;
  /** The class can only run on the manual clock (no music, or song timing missing). */
  readonly manualOnly: boolean;
}

export type { LinkConfig } from "./config.ts";
export { DEFAULT_LINK_CONFIG } from "./config.ts";

/** The states in which the clock follows the music's own position. */
export const FOLLOWING: readonly LinkStateName[] = ["Locked", "Paused", "Ambiguous"];

export interface Ambiguity {
  readonly candidates: readonly number[];
  readonly index: number;
}

export interface Announcement {
  readonly text: string;
  readonly deltaMs: number;
  readonly until: number;
}

export interface LinkModel {
  readonly mode: "following" | "manual";
  readonly state: LinkStateName;
  /** True once a class song has been followed; before that the clock is the instructor's. */
  readonly everLocked: boolean;
  readonly songIndex: number | null;
  /** The last song known for sure (never a guess between repeated recordings). */
  readonly lastSong: number | null;
  readonly amb: Ambiguity | null;
  /** The occurrence the instructor picked, kept while it is still a candidate. */
  readonly pick: number | null;
  /** The next following step moves the clock exactly, without smoothing. */
  readonly force: boolean;
  readonly held: boolean;
  /** The music app reported playing at the last reading (Ambiguous does not say it by its name). */
  readonly playing: boolean;
  /** Monotonic time the next song is expected, while the clock holds (rule 6). */
  readonly holdUntil: number | null;
  readonly announce: Announcement | null;
  /** `clockMs` is where the clock was at monotonic time `at`, the moment of the resync. */
  readonly undo: { readonly clockMs: number; readonly at: number; readonly until: number } | null;
  /** The last unambiguous reading, for measuring the crossfade at a song change. */
  readonly lastPlayed: { readonly songIndex: number; readonly obs: Observation } | null;
  readonly measuredCrossfadeMs: number | null;
  /** The last reading that was applied; a held torn reading never is (torn.ts). */
  readonly applied: Observation | null;
  /** The previous poll's reading was held as torn; the next one decides (no endless hold). */
  readonly tornHeld: boolean;
}

export type LinkEvent =
  | "locked"
  | "ambiguous"
  | "resolved"
  | "relock"
  | "song_change"
  | "seek"
  | "backward"
  | "pause"
  | "resume"
  | "coasting"
  | "off_list"
  | "undo"
  | "undo_unavailable"
  | "relink"
  | "manual"
  | "pick"
  | "torn_hold";

export function initialLink(following: boolean): LinkModel {
  return {
    mode: following ? "following" : "manual",
    state: "Manual",
    everLocked: false,
    songIndex: null,
    lastSong: null,
    amb: null,
    pick: null,
    force: false,
    held: false,
    playing: false,
    holdUntil: null,
    announce: null,
    undo: null,
    lastPlayed: null,
    measuredCrossfadeMs: null,
    applied: null,
    tornHeld: false,
  };
}
