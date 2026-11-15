// A fake class for the demo page, the screenshots and the frame log: three songs and eight
// intervals on a simulated clock. Song 0 (120 bpm, 16 s a phrase) flips its phrase at 16 s, 32 s and
// 48 s, has a drop at 40 s (the build is 36 to 40 s, the fan 40 to 48 s) and ends at 60 s in a
// mirrored phrase, so the song change at 60 s turns from a mirrored phrase. Song 1 has no marked
// moments (light-only bursts on its interval changes); song 2 has a breakdown. Fake data only.
import type { SceneClass, SceneInterval, SceneSong } from "../../model/src/index.ts";
import type { Feed } from "../src/loop.ts";

const SONGS: readonly SceneSong[] = [
  { bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }], moments: [{ at_ms: 40_000, kind: "drop" }] },
  { bpm: 128, anchors: [{ at_ms: 0, bpm: 128 }] },
  { bpm: 100, anchors: [{ at_ms: 0, bpm: 100 }], moments: [{ at_ms: 20_000, kind: "breakdown" }] },
];
export const SONG_STARTS_MS = [0, 60_000, 100_000] as const;
const interval = (startMs: number, zone: number): SceneInterval => ({ startMs, zone });

export const DEMO_CLASS: SceneClass = {
  songs: SONGS,
  endMs: 160_000,
  intervals: [interval(0, 1), interval(20_000, 2), interval(40_000, 4), interval(60_000, 5), interval(80_000, 6), interval(100_000, 7), interval(120_000, 3), interval(140_000, 2)],
};

export function songIndexAt(classMs: number): number {
  let at = 0;
  SONG_STARTS_MS.forEach((s, i) => { if (classMs >= s) at = i; });
  return at;
}

export interface FeedOptions {
  readonly link?: Feed["link"];
  readonly reducedMotion?: boolean;
}

export function feedAt(classMs: number, options: FeedOptions = {}): Feed {
  const songIndex = songIndexAt(classMs);
  return {
    cls: DEMO_CLASS, classMs, songIndex, songPosMs: classMs - SONG_STARTS_MS[songIndex]!,
    link: options.link ?? { state: "Locked" }, reducedMotion: options.reducedMotion ?? false,
  };
}
