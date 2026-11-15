// Whether Start loads the class playlist, and whether the load is confirmed (ADR 0001, amendment
// "Start loads the class playlist", #486). Pure and immutable: the shell passes a monotonic `now`
// and the reader's latest reading. The load never moves the class clock (the clock starts as it
// always did); this module only decides what to ask the music app and what the screen says.
//
// - Only Start loads it, and only at class time 0 (no jump or chosen start before Start). A Start
//   anywhere else, pause, next, a nudge and resume never load it and say nothing new.
// - A class without a playlist says nothing new.
// - The notice "playlist not loaded" shows only when the class has a playlist and the load failed,
//   was not supported, or was not confirmed: the first fresh reading after the music app took the
//   request must match song 1 within PLAYLIST_CONFIRM_MS. Otherwise the existing matching and link
//   states take over, as for any song the class does not expect.
import { isCurrent } from "./follower.ts";
import { matchCandidates } from "./match.ts";
import { isPlaylistId } from "./playlist.ts";
import type { LoadOutcome } from "./playlist.ts";
import { DEFAULT_LINK_CONFIG } from "./types.ts";
import type { LinkConfig, LinkPlan, Observation } from "./types.ts";

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
  | { readonly kind: "asking"; readonly until: number }
  /** The music app took it at `from`; the first reading dated from then decides. */
  | { readonly kind: "confirming"; readonly from: number; readonly until: number }
  | { readonly kind: "confirmed" }
  | { readonly kind: "not-loaded" };

export const NO_LOAD: PlaylistLoad = Object.freeze({ kind: "none" });
const NOT_LOADED: PlaylistLoad = Object.freeze({ kind: "not-loaded" });

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
  if (!f.isStart || !f.atZero || f.playlist === undefined) return { load: current, ask: null };
  if (!isPlaylistId(f.playlist) || !f.toMusic || !f.canLoad) return { load: NOT_LOADED, ask: null };
  return { load: { kind: "asking", until: now + PLAYLIST_CONFIRM_MS }, ask: f.playlist };
}

/** The follower's answer. One that comes after the load was decided changes nothing. */
export function loadAnswered(load: PlaylistLoad, outcome: LoadOutcome, now: number): PlaylistLoad {
  if (load.kind !== "asking") return load;
  return outcome === "asked" ? { kind: "confirming", from: now, until: now + PLAYLIST_CONFIRM_MS } : NOT_LOADED;
}

/** True when an answer means Start must press play as before (the load did not go). */
export const fallsBack = (before: PlaylistLoad, outcome: LoadOutcome): boolean => before.kind === "asking" && outcome !== "asked";

/** One tick: the first fresh reading decides, and no answer or reading in time means not loaded. */
export function confirmLoad(load: PlaylistLoad, plan: LinkPlan, obs: Observation | null, now: number, cfg: LinkConfig = DEFAULT_LINK_CONFIG): PlaylistLoad {
  if (load.kind === "asking") return now > load.until ? NOT_LOADED : load;
  if (load.kind !== "confirming") return load;
  const fresh = obs !== null && obs.at >= load.from && obs.seenAt <= load.until && isCurrent(obs, now, cfg.staleMs);
  if (fresh) return matchCandidates(plan, obs, cfg).includes(0) ? { kind: "confirmed" } : NOT_LOADED;
  return now > load.until ? NOT_LOADED : load;
}

/** The screen says the playlist was not loaded. */
export const playlistNotLoaded = (load: PlaylistLoad): boolean => load.kind === "not-loaded";
