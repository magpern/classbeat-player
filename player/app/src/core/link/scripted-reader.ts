// A scripted fake reader for tests: a description of what the music app really does over time
// (segments), turned into readings the way a real reader would deliver them. Pure, no I/O.
import type { MusicReader } from "./reader.ts";
import type { Observation, TrackInfo } from "./types.ts";

export interface Segment {
  /** Monotonic time this starts, in ms. Segments are given in order. */
  readonly from: number;
  /** What the app has loaded; null when it is closed. */
  readonly track: TrackInfo | null;
  /** The real position at `from`. */
  readonly positionMs: number;
  readonly playing: boolean;
  /** False: the reader delivers nothing new during this segment (readings stop or go stale). */
  readonly delivering?: boolean;
  /** The system updated the position this long before the reader got it (Windows style). */
  readonly lagMs?: number;
  readonly app?: string | null;
}

export interface ScriptedReader extends MusicReader {
  readonly kind: "fake";
}

export function createScriptedReader(segments: readonly Segment[]): ScriptedReader {
  let last: Observation | null = null;
  return {
    kind: "fake",
    latest(now) {
      const seg = [...segments].reverse().find((s) => s.from <= now);
      if (!seg || seg.delivering === false) return last;
      if (seg.track === null) return (last = null);
      const lag = seg.lagMs ?? 0;
      // The system cannot have updated the position before this segment began.
      const at = Math.max(seg.from, now - lag);
      const positionMs = seg.positionMs + (seg.playing ? at - seg.from : 0);
      last = { ...seg.track, app: seg.app ?? null, positionMs, playing: seg.playing, at, seenAt: now };
      return last;
    },
  };
}
