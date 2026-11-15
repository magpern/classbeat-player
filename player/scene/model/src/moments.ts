// The song's marked moments as they steer the rig (scene.md "What drives what"), and the
// light-only bursts of a song with none. Windows are counted in beats at the song's bpm; with no
// bpm no window is known and none is guessed. Pure.

export interface SongMoment {
  readonly at_ms: number;
  readonly kind: "drop" | "breakdown" | "build" | "other";
}

/** What the moments do to direction. A light-only burst is `NO_MOMENTS`. */
export interface Moments {
  /** Build: every beam gathers to one point. */
  readonly gather: boolean;
  /** Drop: every fixture fanned wide for 4 bars. */
  readonly fan: boolean;
  /** Breakdown: one slow beam and the wall for 8 bars (light, not shape). */
  readonly breakdown: boolean;
}

export const NO_MOMENTS: Moments = { gather: false, fan: false, breakdown: false };
const BUILD_BEATS = 8;
const DROP_BEATS = 16;
const BREAKDOWN_BEATS = 32;

export function momentsAt(items: readonly SongMoment[] | undefined, bpm: number | undefined, posMs: number): Moments {
  if (!items || items.length === 0 || bpm === undefined || !(bpm > 0)) return NO_MOMENTS;
  const beat = 60_000 / bpm;
  const within = (from: number, beats: number) => posMs >= from && posMs < from + beats * beat;
  let gather = false, fan = false, breakdown = false;
  for (const m of items) {
    if (m.kind === "drop") {
      gather ||= within(m.at_ms - BUILD_BEATS * beat, BUILD_BEATS);
      fan ||= within(m.at_ms, DROP_BEATS);
    } else if (m.kind === "build") gather ||= within(m.at_ms, BUILD_BEATS);
    else if (m.kind === "breakdown") breakdown ||= within(m.at_ms, BREAKDOWN_BEATS);
  }
  return { gather, fan: fan && !gather, breakdown };
}

/** How long the build has gone on, in ms, or null outside a build (the gather's window, as `momentsAt` has it). */
export function buildElapsedMs(items: readonly SongMoment[] | undefined, bpm: number | undefined, posMs: number): number | null {
  if (!items || bpm === undefined || !(bpm > 0)) return null;
  const beat = 60_000 / bpm;
  for (const m of items) {
    const from = m.kind === "drop" ? m.at_ms - BUILD_BEATS * beat : m.kind === "build" ? m.at_ms : null;
    if (from !== null && posMs >= from && posMs < from + BUILD_BEATS * beat) return posMs - from;
  }
  return null;
}

export interface LightBurst {
  readonly kind: "light";
  readonly colour: "white";
  /** A burst never steers: no gather, no fan (rule 4). */
  readonly moments: Moments;
}

export const BURST_GAP_MS = 10_000;

/**
 * A burst on an interval change, only in a song with no marked moments, at least 10 s after the
 * last one. Light only: it carries no direction.
 */
export function intervalBurst(songHasMoments: boolean, atIntervalChange: boolean, msSinceLastBurst: number | null): LightBurst | null {
  if (songHasMoments || !atIntervalChange) return null;
  if (msSinceLastBurst !== null && msSinceLastBurst < BURST_GAP_MS) return null;
  return { kind: "light", colour: "white", moments: NO_MOMENTS };
}
