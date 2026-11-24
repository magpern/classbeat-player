// The count of the shared 1 (scene.md "Steady light and sweeps", "The CI check that the sway makes at most 1", "The CI check that a sweep
// makes at most 1", "The CI gate for a burst's decay"): a sweep, the looks' sway and a burst's decay are counted inside one change per
// 1 s window, steady light's possible change with them. Its count c is the most changes the strict measure (tools/luminance-steps.ts:
// monotone runs of more than 10 % of the larger end, each direction a change, in every region of the gate) finds in any 1 s window of a
// stretch, on a frame drawn with no scheduled change but the burst's rise. Pure: no browser, no clock.
import { findChanges, mostInASecond } from "./luminance-steps.ts";
import type { Change } from "./luminance-steps.ts";

/** `--scene-sweep-max`, `--scene-sway-max` and the burst's decay: at most this many changes in any 1 s. */
export const SHARED_MAX = 1;
const FRAME_MS = 1000 / 60;
const SECOND_MS = 1000;

/** A stretch of the run in wall milliseconds (the frames' own times): the frames of a decay, a sweep's window or the live span. */
export interface Stretch { readonly fromMs: number; readonly toMs: number }

/**
 * The rising change that holds the rise frame: the last change that starts at or before the rise (within a frame and a half, the rise
 * placed on its own frame) and rises, when the next one starts after the rise. It may start earlier than the rise: where the haze
 * of a build is already climbing, the rise joins its monotone run and the strict measure places the run where it first passed 10 %.
 */
function riseRun(changes: readonly Change[], riseMs: number): Change | undefined {
  const at = changes.filter((c) => c.atMs <= riseMs + 1.5 * FRAME_MS).length - 1;
  const run = changes[at];
  const next = changes[at + 1];
  return run !== undefined && run.rising && (next === undefined || next.atMs > riseMs + 1.5 * FRAME_MS - 1e-6) ? run : undefined;
}

/**
 * The most changes in any 1 s window that holds a frame of `stretch`. The change that holds the rise frame (`riseMs`) is the rise, a mark,
 * and is left out: the burst counts 1 for it beside the shared 1.
 */
export function mostAround(changes: readonly Change[], stretch: Stretch, riseMs: number | null = null): number {
  const rise = riseMs === null ? undefined : riseRun(changes, riseMs);
  const kept = changes.filter((c) => c !== rise);
  const opens = [...kept.map((c) => c.atMs), stretch.fromMs - SECOND_MS + 1e-6, stretch.toMs].filter((s) => s > stretch.fromMs - SECOND_MS && s <= stretch.toMs);
  return Math.max(0, ...opens.map((s) => kept.filter((c) => c.atMs >= s && c.atMs < s + SECOND_MS).length));
}

export interface Worst { readonly most: number; readonly region: string; readonly changes: readonly Change[] }

/** The worst region of a series: `regions[frame][region]`, one row per frame at `wallMs`, with the names of the regions. */
export function worstRegion(names: readonly string[], wallMs: readonly number[], regions: readonly (readonly number[])[], count: (changes: readonly Change[]) => number): Worst {
  let worst: Worst = { most: -1, region: "", changes: [] };
  names.forEach((region, r) => {
    const changes = findChanges(wallMs, regions.map((row) => row[r]!));
    const most = count(changes);
    if (most > worst.most) worst = { most, region, changes };
  });
  return worst;
}

/** The sway's and a sweep's count: every 1 s window of the stretch the case drew, whatever its frames hold. */
export const wholeRun = (changes: readonly Change[]): number => mostInASecond(changes);

export interface BurstFrames {
  /** The rise frame's time, and the stretch of the decay's frames after it (wall ms); null where nothing burst. */
  readonly riseMs: number;
  readonly decay: Stretch;
}

/** Where a burst rose and decayed, from the burst's share of its peak on each frame (`burst`, 0 outside it). Null: no burst in the run. */
export function burstFrames(wallMs: readonly number[], burst: readonly number[]): BurstFrames | null {
  const first = burst.findIndex((b) => b > 0);
  if (first < 0) return null;
  let last = first;
  while (last + 1 < burst.length && burst[last + 1]! > 0) last++;
  return { riseMs: wallMs[first]!, decay: { fromMs: wallMs[Math.min(first + 1, last)]!, toMs: wallMs[last]! } };
}

/** A burst's decay: the most changes in any 1 s window that holds a frame of it, the rise left out. */
export const decayCount = (frames: BurstFrames) => (changes: readonly Change[]): number => mostAround(changes, frames.decay, frames.riseMs);
