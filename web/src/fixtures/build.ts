// Builders for the recorded snapshots the room screen is run and checked against: a class in the
// format of ADR 0003, the clock view at a moment, and the music link view at that moment. The
// screen runs on these alone: no player, no network (AGENTS.md section 3, rule 2).
import type { Class, ClockInput, ClockStatus, LinkInput, LinkStateName, RoomInput } from "../room/input.ts";

type Interval = Class["intervals"][number];
type Song = Class["songs"][number];
type ZoneDef = Class["zone_scale"][number];

const S = 1000;

/** `[length in seconds, zone]` pairs laid end to end from `startMs`. */
export function intervalsFrom(startMs: number, parts: readonly (readonly [number, number])[], cue = "Hold the pace."): Interval[] {
  let t = startMs;
  return parts.map(([sec, zone]) => {
    const iv: Interval = { start_ms: t, length_ms: sec * S, zone, cadence: { from: 85, to: 95 }, position: "seated", cue };
    t += sec * S;
    return iv;
  });
}

/** Songs laid end to end: `[title, artist, length in seconds, bpm]`; the tempo has its own anchors. */
export function songsFrom(startMs: number, parts: readonly (readonly [string, string, number, number])[]): Song[] {
  let t = startMs;
  return parts.map(([title, artist, sec, bpm]) => {
    const song: Song = {
      title,
      artist,
      length_ms: sec * S,
      start_ms: t,
      end_ms: t + sec * S,
      bpm,
      beat_anchors: { quality: "measured", anchors: [{ at_ms: 0, bpm }] },
    };
    t += sec * S;
    return song;
  });
}

export function scaleOf(names: readonly string[], targets: (zone: number) => Omit<ZoneDef, "zone" | "name">): Class["zone_scale"] {
  return names.map((name, i) => ({ zone: i + 1, name, ...targets(i + 1) })) as unknown as Class["zone_scale"];
}

/** Assembles a class; the totals are worked out from the intervals, as a producer would. */
export function classOf(title: string, scale: Class["zone_scale"], intervals: Interval[], songs: Song[], segments: NonNullable<Class["segments"]>, load: number): Class {
  const length = intervals[intervals.length - 1].start_ms + intervals[intervals.length - 1].length_ms;
  const time: Record<string, number> = {};
  for (const iv of intervals) time[String(iv.zone)] = (time[String(iv.zone)] ?? 0) + iv.length_ms;
  return {
    format_version: "1.0",
    class: { title, sport: "cycling", length_ms: length },
    music: { source: "spotify", design_crossfade_ms: 3000, song_timing: "measured" },
    zone_scale: scale,
    totals: { length_ms: length, time_in_zone_ms: time, planned_load: load },
    segments,
    intervals: intervals as Class["intervals"],
    songs,
  };
}

export function indexAt<T extends { start_ms: number }>(items: readonly T[], ms: number): number {
  let found = -1;
  items.forEach((it, i) => {
    if (it.start_ms <= ms) found = i;
  });
  return found;
}

export function clockAt(doc: Class, classMs: number, status: ClockStatus = "running", overrides: Partial<ClockInput> = {}): ClockInput {
  const length = doc.class.length_ms;
  const i = Math.max(0, indexAt(doc.intervals, classMs));
  const iv = doc.intervals[i];
  const song = doc.songs.findIndex((s) => s.start_ms <= classMs && classMs < s.end_ms);
  return {
    status,
    classMs,
    lengthMs: length,
    classRemainingMs: Math.max(0, length - classMs),
    intervalIndex: i,
    intervalRemainingMs: Math.max(0, iv.start_ms + iv.length_ms - classMs),
    nextIntervalIndex: i + 1 < doc.intervals.length ? i + 1 : null,
    songIndex: song < 0 ? null : song,
    ...overrides,
  };
}

export function linkAt(view: ClockInput, state: LinkStateName, overrides: Partial<LinkInput> = {}): LinkInput {
  const manual = state === "Manual";
  return {
    mode: manual ? "manual" : "following",
    available: !manual,
    state,
    guessing: state === "Coasting" || state === "Off the list",
    songIndex: manual || state === "Off the list" ? null : view.songIndex,
    held: false,
    holdRemainingMs: null,
    candidates: [],
    announcement: null,
    classRemainingMs: view.classRemainingMs,
    ...overrides,
  };
}

export function snapshot(doc: Class, classMs: number, state: LinkStateName, status: ClockStatus = "running"): RoomInput {
  const view = clockAt(doc, classMs, status);
  return { doc, view, link: linkAt(view, state) };
}

export function withCue(doc: Class, index: number, cue: string, patch: Partial<Interval> = {}): Class {
  const intervals = doc.intervals.map((iv, i) => (i === index ? { ...iv, cue, ...patch } : iv)) as Class["intervals"];
  return { ...doc, intervals };
}
