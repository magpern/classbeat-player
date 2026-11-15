// The class playlist that Start may ask Spotify's own app to play (ADR 0001, amendment "Start
// loads the class playlist", #486). Pure: the id check, the one link ever built from it, and the
// shape of a follower that can load it. The id comes from the class file, so it is checked again
// here at the edge, immediately before any command is built: the command is only ever the fixed
// prefix plus an id of exactly 22 letters or digits, and no other class data reaches a script or a
// command. Nothing here plays, fetches or stores audio, uses a Spotify Web API or needs a token
// (plan section 3, rule 3): the music stays in Spotify's own app.

/** The one fixed prefix: a Spotify playlist link for the local app. */
export const PLAYLIST_URI_PREFIX = "spotify:playlist:";

/** The class format's id (schema/class-format, format 1.2): exactly 22 letters or digits. */
const PLAYLIST_ID = /^[A-Za-z0-9]{22}$/;

/** The length is checked as well: no line break or anything else can follow a valid id. */
export const isPlaylistId = (v: unknown): v is string => typeof v === "string" && v.length === 22 && PLAYLIST_ID.test(v);

/** The link for one playlist; null for anything that is not a well-formed id (nothing is built). */
export function playlistUri(id: unknown): string | null {
  return isPlaylistId(id) ? PLAYLIST_URI_PREFIX + id : null;
}

/**
 * What a follower answered when it was asked to load a playlist:
 * - `asked`: the music app took the request (a fresh reading then confirms it, playlist-load.ts);
 * - `not-running`: the music app is closed, and was not started;
 * - `failed`: the request was refused, failed, hung or could not be built;
 * - `unsupported`: this follower cannot load a playlist (or is not following now).
 */
export type LoadOutcome = "asked" | "not-running" | "failed" | "unsupported";

/** Only on a follower that can load a playlist (macOS, Linux; the fake records the request). */
export interface PlaylistLoader {
  /** Never waits and never throws; `done` is called exactly once. */
  loadPlaylist(id: string, done: (outcome: LoadOutcome) => void): void;
}

export const canLoadPlaylist = (t: unknown): t is PlaylistLoader =>
  typeof t === "object" && t !== null && typeof (t as { loadPlaylist?: unknown }).loadPlaylist === "function";

/** The fake follower's part: it loads nothing, records every request and answers as told. */
export interface FakeLoader extends PlaylistLoader {
  readonly requests: string[];
  /** The answer the next requests get; `unsupported` unless a test says otherwise. */
  outcome: LoadOutcome;
}

export function createFakeLoader(outcome: LoadOutcome = "unsupported"): FakeLoader {
  const self: FakeLoader = {
    requests: [],
    outcome,
    loadPlaylist(id, done) {
      self.requests.push(id);
      done(self.outcome);
    },
  };
  return self;
}
