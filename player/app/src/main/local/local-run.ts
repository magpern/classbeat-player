// The state of one open class's local playback (local-player.ts): its slots, check, clocks and
// the music time. Plain data and its constructor; nothing here does I/O.
import type { MusicReading } from "../../core/clock/music-link.ts";
import type { FindAnswer } from "../../core/music-files/answer.ts";
import type { LocalCue } from "../../core/music-files/local-cue.ts";
import { localTimingOf } from "../../core/music-files/local-timing.ts";
import type { LocalTiming } from "../../core/music-files/local-timing.ts";
import { wantedFiles } from "../../core/music-files/wanted.ts";
import type { WantedFile } from "../../core/music-files/wanted.ts";
import type { Snapshot } from "../../core/snapshot.ts";
import type { LocalPlay } from "./local-plays.ts";
import type { LocalPlayState } from "./local-player.ts";

export interface Slot {
  readonly k: number;
  readonly play: LocalPlay;
  /** The decoded length last reported: a wrong one counts only when the next report agrees. */
  duration: number | null;
}

export interface Run {
  readonly loadId: number;
  readonly doc: unknown;
  readonly timing: LocalTiming | null;
  readonly wanted: readonly WantedFile[];
  check: FindAnswer | null;
  checking: boolean;
  checkedAt: number;
  /** Songs whose file failed to open or decode, or whose length two reports confirmed wrong. */
  readonly bad: Set<number>;
  /** Songs whose length was read before Start. */
  readonly probed: Set<number>;
  started: boolean;
  /** Start came and the check is being run again: nothing plays until it answers. */
  starting: boolean;
  /** The controller's latest view, kept while the second check runs. */
  last: { status: string; classMs: number; at: number } | null;
  status: string | null;
  state: LocalPlayState | null;
  account: string | null;
  slots: [Slot | null, Slot | null];
  cue: LocalCue | null;
  cuedAt: number;
  answered: boolean;
  /** The controller's clock at the last snapshot, to tell a command's jump from time passing. */
  clock: { classMs: number; at: number; running: boolean };
  /** The music time: where the files are on the class's timeline. */
  music: { t: number; at: number; running: boolean };
  reading: MusicReading | null;
}

export function runOf(s: Snapshot): Run {
  const doc = s.doc;
  const wanted = doc === null ? null : wantedFiles(doc);
  const timing = doc === null || wanted === null ? null : localTimingOf(doc.songs.map((g) => ({ startMs: g.start_ms, endMs: g.end_ms, lengthMs: g.length_ms })), doc.music.design_crossfade_ms, doc.class.length_ms);
  const zero = { classMs: 0, at: 0, running: false };
  return { loadId: s.loadId, doc, timing, wanted: wanted ?? [], check: null, checking: false, checkedAt: -Infinity, bad: new Set(), probed: new Set(), started: false, starting: false, last: null, status: null, state: null, account: null, slots: [null, null], cue: null, cuedAt: 0, answered: false, clock: zero, music: { t: 0, at: 0, running: false }, reading: null };
}
