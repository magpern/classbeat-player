// Whether Start loads the class playlist, and whether the load is confirmed (ADR 0001, amendment
// "Start loads the class playlist", #486). Pure and immutable: the shell passes a monotonic `now`
// and the reader's latest reading. The load never moves the class clock (the clock starts as it
// always did); this module only decides what to ask the music app and what the screen says.
//
// - Only Start loads it, and only at class time 0 (no jump or chosen start before Start). A Start
//   anywhere else, pause, next, a nudge and resume never load it and say nothing new.
// - A class without a playlist says nothing new.
// - "Not loaded" is decided only when Start asked the music app to play (it goes to the music):
//   the class has no playlist, or loading failed or is not supported, or the load was not confirmed
//   (the first fresh reading after the music app took the request must match song 1 within
//   PLAYLIST_CONFIRM_MS). On the manual clock nothing was asked of the music app: nothing is said.
// - The notice (docs/design/presenter.md "Music link line", room-2d.md "Playlist not loaded") shows
//   for 30 s after that Start (`undoWindowMs`), only while following, in the place of the quiet
//   link states, never over a fault state. `playlistNoticeAt` decides it.
import { isCurrent } from "./follower.ts";
import { matchCandidates } from "./match.ts";
import { isPlaylistId } from "./playlist.ts";
import type { LoadOutcome } from "./playlist.ts";
import { DEFAULT_LINK_CONFIG } from "./types.ts";
import type { LinkConfig, LinkModel, LinkPlan, Observation } from "./types.ts";

/**
 * How long a load may take to show: a fresh reading of song 1 within 3 s of the music app taking
 * the request (and the request answered within 3 s of Start). A follower's call is killed well
 * before this (700 ms), and a reading arrives four times a second.
 */
export const PLAYLIST_CONFIRM_MS = 3000;

export type PlaylistLoad =
  /** Nothing was asked: no playlist, not a Start at class time 0, or no class. */
  | { readonly kind: "none" }
  /** Asked at Start; the follower has not answered yet. */
  | { readonly kind: "asking"; readonly until: number; readonly startedAt: number }
  /** The music app took it at `from`; the first reading dated from then decides. */
  | { readonly kind: "confirming"; readonly from: number; readonly until: number; readonly startedAt: number }
  | { readonly kind: "confirmed" }
  /** Decided not loaded; `startedAt` is the Start it belongs to (the notice's 30 s run from it). */
  | { readonly kind: "not-loaded"; readonly startedAt: number };

export const NO_LOAD: PlaylistLoad = Object.freeze({ kind: "none" });
const notLoaded = (startedAt: number): PlaylistLoad => Object.freeze({ kind: "not-loaded", startedAt });

export interface StartFacts {
  /** The command is Start. */
  readonly isStart: boolean;
  /** The class's `music.spotify_playlist`, as the document has it (undefined when absent). */
  readonly playlist: unknown;
  /** The clock is ready at class time 0. */
  readonly atZero: boolean;
  /** Start goes to the music app (the instructor follows the music and a transport exists). */
  readonly toMusic: boolean;
  /** The follower can load a playlist. */
  readonly canLoad: boolean;
}

export interface StartLoad {
  readonly load: PlaylistLoad;
  /** The id to ask the follower to load, or null: nothing is asked. */
  readonly ask: string | null;
}

export function loadAtStart(current: PlaylistLoad, f: StartFacts, now: number): StartLoad {
  if (!f.isStart || !f.atZero) return { load: current, ask: null };
  // Start did not go to the music app (the manual clock): nothing was asked of it, nothing is said.
  if (!f.toMusic) return { load: NO_LOAD, ask: null };
  if (!isPlaylistId(f.playlist) || !f.canLoad) return { load: notLoaded(now), ask: null };
  return { load: { kind: "asking", until: now + PLAYLIST_CONFIRM_MS, startedAt: now }, ask: f.playlist };
}

/** The follower's answer. One that comes after the load was decided changes nothing. */
export function loadAnswered(load: PlaylistLoad, outcome: LoadOutcome, now: number): PlaylistLoad {
  if (load.kind !== "asking") return load;
  return outcome === "asked" ? { kind: "confirming", from: now, until: now + PLAYLIST_CONFIRM_MS, startedAt: load.startedAt } : notLoaded(load.startedAt);
}

/**
 * True when an answer means Start must press play as before (the load did not go). That holds for
 * a late answer too (after the 3 s window `before` is `not-loaded`): Start's job is to start the
 * music and nothing else did. A late `asked` does not: Spotify is loading the playlist. The shell
 * still sends nothing when a newer command or another class has come since.
 */
export const fallsBack = (before: PlaylistLoad, outcome: LoadOutcome): boolean => (before.kind === "asking" || before.kind === "not-loaded") && outcome !== "asked";

/** One tick: the first fresh reading decides, and no answer or reading in time means not loaded. */
export function confirmLoad(load: PlaylistLoad, plan: LinkPlan, obs: Observation | null, now: number, cfg: LinkConfig = DEFAULT_LINK_CONFIG): PlaylistLoad {
  if (load.kind === "asking") return now > load.until ? notLoaded(load.startedAt) : load;
  if (load.kind !== "confirming") return load;
  const fresh = obs !== null && obs.at >= load.from && obs.seenAt <= load.until && isCurrent(obs, now, cfg.staleMs);
  if (fresh) return matchCandidates(plan, obs, cfg).includes(0) ? { kind: "confirmed" } : notLoaded(load.startedAt);
  return now > load.until ? notLoaded(load.startedAt) : load;
}

/** Start asked the music app and the class playlist was not loaded (decided; the screen's window is `playlistNoticeAt`). */
export const playlistNotLoaded = (load: PlaylistLoad): boolean => load.kind === "not-loaded";

/** The quiet link states, the only ones the notice takes the place of: following and locked, or before the first lock. */
const isQuiet = (l: Pick<LinkModel, "mode" | "state">): boolean => l.mode === "following" && (l.state === "Locked" || l.state === "Manual");

/**
 * Whether the screens say "Playlist not loaded" now: Start asked the music app and the playlist was
 * not loaded, within `undoWindowMs` (30 s) of that Start, while following and in a quiet link state.
 * A fault state ("Music not heard", "Not a class song", "Song is in twice", "Music paused") and the
 * manual clock never show it. The first Start only: a later resume does not make a new window.
 */
export const playlistNoticeAt = (load: PlaylistLoad, link: Pick<LinkModel, "mode" | "state">, now: number, cfg: LinkConfig = DEFAULT_LINK_CONFIG): boolean =>
  load.kind === "not-loaded" && now >= load.startedAt && now - load.startedAt < cfg.undoWindowMs && isQuiet(link);
