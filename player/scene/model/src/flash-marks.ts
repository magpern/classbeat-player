// The flash budget's frame marks (scene.md "The flash budget", text rule 2): the placement P1 (the fixed
// frames, merged) and P2 (every other mark, in order). One invariant: any two frame marks are at least
// 500 ms apart, in time, at any refresh rate, so any 1 s window holds at most 2. Times are milliseconds on the
// class clock; a frame is a multiple of `frameMs`. Pure: no clock, no I/O, nothing about riders. Shared by the
// scene, the plain screen and the player, which all schedule the same text steps (#583, #585).

/** The least time between two frame marks. */
export const MARK_GAP_MS = 500;
/** Interval changes (and drops) less than this after a fixed frame merge into it. */
export const MERGE_MS = 1000;
const EPS = 1e-6;

/** The first frame at or after `ms`. */
export const frameAt = (ms: number, frameMs: number): number => Math.ceil(ms / frameMs - 1e-9) * frameMs + 0;

export interface FixedFrame {
  readonly atMs: number;
  /** True when an interval change is in it: its gel, numeral, name and values show the latest merged change. */
  readonly change: boolean;
  /** The interval changes it holds, in time order (the latest wins what is shown); empty for a drop frame. */
  readonly changes: readonly number[];
  /** The drops it holds (their light only; movement never merges). */
  readonly drops: readonly number[];
}

/** P1: the change frames (a chain from the first, each taking the changes under 1 s after it), then the drops. */
export function fixedFrames(changeTimes: readonly number[], dropTimes: readonly number[], frameMs: number): FixedFrame[] {
  const frames: { at: number; change: boolean; changes: number[]; drops: number[] }[] = [];
  for (const t of [...changeTimes].sort((a, b) => a - b)) {
    const last = frames.at(-1);
    if (last && t - last.changes[0]! < MERGE_MS) last.changes.push(t);
    else frames.push({ at: t, change: true, changes: [t], drops: [] });
  }
  const left: number[] = [];
  for (const d of [...dropTimes].sort((a, b) => a - b)) {
    const near = frames.filter((f) => f.change && Math.abs(d - f.at) < MERGE_MS).sort((a, b) => Math.abs(d - a.at) - Math.abs(d - b.at))[0];
    if (near) near.drops.push(d);
    else left.push(d);
  }
  let chain: (typeof frames)[number] | undefined;
  for (const d of left) {
    if (chain && d - chain.at < MERGE_MS) chain.drops.push(d);
    else frames.push((chain = { at: d, change: false, changes: [], drops: [d] }));
  }
  return frames.sort((a, b) => a.at - b.at).map((f) => ({ atMs: frameAt(f.at, frameMs), change: f.change, changes: f.changes, drops: f.drops }));
}

/** A user action (pause, resume, seek, jump), the count's switch beat, or any other tick. */
export interface Want {
  readonly kind: "action" | "switch" | "tick";
  readonly atMs: number;
  /** A tick's period: how late it may be before it joins a fixed frame or is dropped (1000 for the countdown, a beat for the count). */
  readonly periodMs?: number;
}
export type Outcome = "own" | "replaced" | "joined" | "dropped";
export interface Placed {
  readonly want: Want;
  readonly how: Outcome;
  /** The frame it shows on (null when dropped: its value shows on the next mark). */
  readonly atMs: number | null;
}

const RANK = { action: 0, switch: 1, tick: 2 } as const;
const ACTION_LATE_MS = 500;
const TICK_LATE_MS = 1000;

/**
 * P2: user actions as they come, then the switch beats, then the other ticks, each on the earliest frame at or after
 * its time that is at least 500 ms from every mark already placed (the fixed frames included). Too late (over 500 ms
 * for an action, over a tick period for a tick) it joins the nearest following fixed frame, or a tick is dropped.
 * A later action replaces a pending one in its placed frame. Returns one entry per want, and never moves a fixed frame.
 */
export function placeMarks(fixed: readonly FixedFrame[], wants: readonly Want[], frameMs: number): Placed[] {
  const marks = fixed.map((f) => f.atMs);
  const actionFrames: number[] = [];
  const out = new Map<Want, Placed>();
  const ordered = [...wants].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.atMs - b.atMs);
  for (const want of ordered) {
    const from = frameAt(want.atMs, frameMs);
    const pending = want.kind === "action" ? actionFrames.find((f) => f >= from - EPS) : undefined;
    if (pending !== undefined) { out.set(want, { want, how: "replaced", atMs: pending }); continue; }
    let at = from;
    for (let moved = true; moved; ) {
      moved = false;
      for (const m of marks) if (Math.abs(at - m) < MARK_GAP_MS - EPS) { at = frameAt(m + MARK_GAP_MS - EPS, frameMs); moved = true; }
    }
    const limit = want.kind === "action" ? ACTION_LATE_MS : (want.periodMs ?? TICK_LATE_MS);
    if (at - want.atMs > limit + EPS) {
      const next = fixed.find((f) => f.atMs >= want.atMs - EPS);
      if (next && (want.kind === "action" || next.atMs - want.atMs <= limit)) {
        if (want.kind === "action") actionFrames.push(next.atMs);
        out.set(want, { want, how: "joined", atMs: next.atMs });
        continue;
      }
      if (want.kind !== "action") { out.set(want, { want, how: "dropped", atMs: null }); continue; }
    }
    marks.push(at);
    if (want.kind === "action") actionFrames.push(at);
    out.set(want, { want, how: "own", atMs: at });
  }
  return wants.map((w) => out.get(w)!);
}
