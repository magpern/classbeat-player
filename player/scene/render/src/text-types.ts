// What the text layer is told about the class (scene.md "Content, in priority order"): the class
// as the room window reads it, in the words the screen shows. The shell maps its class format onto
// this; the scene never sees the class file. Types only: no per-person data has a place here (rule 1).

import type { BeatAnchor, LinkInput, SongMoment, StartOn } from "../../model/src/index.ts";

export type Side = "seated" | "standing";
export type Cadence = { readonly from: number; readonly to: number } | "beat";

export interface TextPattern {
  readonly positions: readonly Side[];
  readonly beats: readonly number[];
  readonly startOn: StartOn;
}

export interface TextInterval {
  readonly startMs: number;
  readonly lengthMs: number;
  readonly zone: number;
  readonly name: string;
  readonly cue: string;
  readonly cadence: Cadence | null;
  readonly position: Side | null;
  readonly pattern: TextPattern | null;
}

export interface TextSong {
  readonly title: string;
  readonly artist: string;
  /** Where the song starts on the class clock. */
  readonly startMs: number;
  readonly lengthMs: number;
  readonly bpm?: number;
  readonly anchors?: readonly BeatAnchor[];
  readonly moments?: readonly SongMoment[];
}

/** The class's own name and targets for a zone (the class's scale, not ours). */
export interface TextZone {
  readonly zone: number;
  readonly name: string;
  readonly targets: readonly string[];
}

export interface TextClass {
  readonly title: string;
  readonly endMs: number;
  readonly zones: readonly TextZone[];
  readonly intervals: readonly TextInterval[];
  readonly songs: readonly TextSong[];
  readonly segments: readonly { readonly startMs: number; readonly name: string }[];
  /** "Following Spotify": the link state's words while the music is followed. */
  readonly following: string;
  /** Set by `mergeTextClass`: the score keeps every interval as the class has it, and those merged away (by start) have no number and no colour. */
  readonly score?: { readonly intervals: readonly TextInterval[]; readonly away: readonly number[] };
}

/**
 * The link as the plate's words need it: the model's link, with what the plain screen's words add (web/src/room/link-text.ts). All optional,
 * so a plain `LinkInput` is a link with no more to say. The text clock's frame marks watch every field, so a change of any is a step.
 */
export interface TextLink extends LinkInput {
  /** "following": the instructor chose the music, so "Manual" is the wait for the first lock; "manual": the clock is the instructor's own. */
  readonly mode?: "following" | "manual";
  /** The hand-over announcement is on ("Following stopped"). */
  readonly announcement?: boolean;
  /** The music could be followed ("Manual · F to follow"). */
  readonly available?: boolean;
  /** False before the clock is started. */
  readonly started?: boolean;
}

export interface TextInput {
  readonly cls: TextClass;
  readonly classMs: number;
  readonly songIndex: number;
  readonly songPosMs: number;
  readonly link: TextLink;
  readonly reducedMotion: boolean;
  /** The shell's notice that the class playlist did not load (30 s after Start): the link plate says so while the music is followed. Absent counts as false. */
  readonly playlistNotLoaded?: boolean;
  /** Window width over height. */
  readonly aspect: number;
}
