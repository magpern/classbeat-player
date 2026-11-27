// When each song of a local class plays, and what class time a song position is (ADR 0017
// section 3; ADR 0001 rules 1 to 3). Pure. "Music time" is the timeline the files play on: song k
// starts at its `start_ms` from its own position 0, so at music time t it is at t - start_ms. It
// stops at the earliest of its own end, `end_ms + design_crossfade_ms` and the class end, and never
// later than the song after next starts, so at most two songs sound at once. Class time is music
// time held at the owner's `end_ms`; the owner is the latest song that started (the incoming song
// owns the overlap, ADR 0001 rule 3).
import type { Fade } from "./local-cue.ts";

export interface LocalSong {
  readonly startMs: number;
  readonly endMs: number;
  /** The song's length the class was designed with, `length_ms`. */
  readonly lengthMs: number;
}

export interface LocalTiming {
  readonly songs: readonly LocalSong[];
  /** Per song, the music time it stops at. */
  readonly stops: readonly number[];
  readonly classLengthMs: number;
}

export function localTimingOf(songs: readonly LocalSong[], crossfadeMs: number, classLengthMs: number): LocalTiming {
  const stops = songs.map((s, k) => {
    const afterNext = songs[k + 2]?.startMs ?? Infinity;
    return Math.max(s.startMs, Math.min(s.startMs + s.lengthMs, s.endMs + crossfadeMs, classLengthMs, afterNext));
  });
  return { songs, stops, classLengthMs };
}

/** The songs sounding at music time t, in song order: started, and not yet stopped. */
export function activeAt(timing: LocalTiming, t: number): number[] {
  const out: number[] = [];
  timing.songs.forEach((s, k) => {
    if (s.startMs <= t && t < timing.stops[k]!) out.push(k);
  });
  return out;
}

/** The song that owns music time t: the latest one sounding, or null in a gap. */
export function ownerAt(timing: LocalTiming, t: number): number | null {
  const a = activeAt(timing, t);
  return a.length === 0 ? null : a[a.length - 1]!;
}

/** The class time of music time t: t, held at the owner's `end_ms`, never past the class end. */
export function classTimeOf(timing: LocalTiming, t: number): number {
  const k = ownerAt(timing, t);
  const held = k === null ? t : Math.min(t, timing.songs[k]!.endMs);
  return Math.min(Math.max(held, 0), timing.classLengthMs);
}

/** Which song each <audio> holds at music time t: song k in slot k % 2, or null when that slot is silent. */
export function slotsAt(timing: LocalTiming, t: number): [number | null, number | null] {
  const out: [number | null, number | null] = [null, null];
  for (const k of activeAt(timing, t)) out[k % 2] = k;
  return out;
}

/** Song k's fade in from the song before, fade out into the song after, and stop, in its own positions. */
export function fadeOf(timing: LocalTiming, k: number): Fade {
  const s = timing.songs[k]!;
  const stop = timing.stops[k]!;
  const before = timing.stops[k - 1];
  const inToMs = before !== undefined && before > s.startMs ? before - s.startMs : 0;
  const next = timing.songs[k + 1];
  const outFrom = next !== undefined && next.startMs < stop ? Math.max(next.startMs, s.startMs) : stop;
  return { inToMs, outFromMs: outFrom - s.startMs, stopMs: stop - s.startMs };
}
