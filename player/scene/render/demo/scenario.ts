// A fake class for the demo page, the screenshots and the frame log: three songs and eight
// intervals on a simulated clock. Song 0 (120 bpm, 16 s a phrase) flips its phrase at 16 s, 32 s and
// 48 s, has a drop at 40 s (on an interval change: the build is 36 to 40 s, the fan 40 to 48 s) and one at 58 s (away from any change, so its burst fits)
// and ends at 60 s in a
// mirrored phrase, so the song change at 60 s turns from a mirrored phrase. Song 1 has no marked
// moments (light-only bursts on its interval changes); song 2 has a breakdown, and its interval at 120 s
// (zone 3) carries an 8 up, 8 down position pattern. Fake data only.
import type { SceneClass, SceneInterval, SceneSong } from "../../model/src/index.ts";
import type { Feed } from "../src/loop.ts";

const SONGS: readonly SceneSong[] = [
  { bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }], moments: [{ at_ms: 40_000, kind: "drop" }, { at_ms: 58_000, kind: "drop" }] },
  { bpm: 128, anchors: [{ at_ms: 0, bpm: 128 }] },
  { bpm: 100, anchors: [{ at_ms: 0, bpm: 100 }], moments: [{ at_ms: 20_000, kind: "breakdown" }] },
];
export const SONG_STARTS_MS = [0, 60_000, 100_000] as const;
const interval = (startMs: number, zone: number, pattern?: unknown): SceneInterval => (pattern === undefined ? { startMs, zone } : { startMs, zone, pattern });
/** 8 beats up (standing), 8 down (seated), counted from the interval's start: the class's one position pattern. */
const UP_DOWN = { positions: ["standing", "seated"], beats: [8, 8], startOn: "interval_start" };

export const DEMO_CLASS: SceneClass = {
  songs: SONGS,
  endMs: 160_000,
  intervals: [interval(0, 1), interval(20_000, 2), interval(40_000, 4), interval(60_000, 5), interval(80_000, 6), interval(100_000, 7), interval(120_000, 3, UP_DOWN), interval(140_000, 2)],
};

/** A variant of the demo class for the gate's collisions and for the dim: the same songs, other intervals or song changes. */
export interface Variant {
  readonly cls: SceneClass;
  readonly starts: readonly number[];
}
const DEMO_VARIANT: Variant = { cls: DEMO_CLASS, starts: SONG_STARTS_MS };
/** Collisions (scene.md "The flash budget", P1): intervals under 1 s apart (20.0 and 20.4 s, 80.0 and 80.3 s, 100.0 and 100.6 s) and a drop near a change but not on it (40.4 s against 40.0 s). */
const COLLIDE_SONGS: readonly SceneSong[] = SONGS.map((s, i) => (i === 0 ? { ...s, moments: [{ at_ms: 40_400, kind: "drop" as const }, { at_ms: 58_000, kind: "drop" as const }] } : s));
const COLLIDE_CLASS: SceneClass = {
  songs: COLLIDE_SONGS, endMs: DEMO_CLASS.endMs,
  intervals: [...DEMO_CLASS.intervals, interval(20_400, 3), interval(80_300, 3), interval(100_600, 5)].sort((a, b) => a.startMs - b.startMs),
};
/** A song change away from any interval change (at 70 s, into a song with no moments), where the song-change dim has room. */
const DIM_CLASS: SceneClass = { ...DEMO_CLASS, songs: [SONGS[0]!, SONGS[1]!, SONGS[1]!, SONGS[2]!] };
export const VARIANTS: Readonly<Record<string, Variant>> = {
  demo: DEMO_VARIANT,
  collide: { cls: COLLIDE_CLASS, starts: SONG_STARTS_MS },
  dim: { cls: DIM_CLASS, starts: [0, 60_000, 70_000, 100_000] },
};

export function songIndexAt(classMs: number, starts: readonly number[] = SONG_STARTS_MS): number {
  let at = 0;
  starts.forEach((s, i) => { if (classMs >= s) at = i; });
  return at;
}

export interface FeedOptions {
  readonly link?: Feed["link"];
  readonly reducedMotion?: boolean;
  readonly stage?: Feed["stage"];
  readonly variant?: Variant;
}

export function feedAt(classMs: number, options: FeedOptions = {}): Feed {
  const { cls, starts } = options.variant ?? DEMO_VARIANT;
  const songIndex = songIndexAt(classMs, starts);
  return {
    cls, classMs, songIndex, songPosMs: classMs - starts[songIndex]!,
    link: options.link ?? { state: "Locked" }, reducedMotion: options.reducedMotion ?? false,
    ...(options.stage === undefined ? {} : { stage: options.stage }),
  };
}
