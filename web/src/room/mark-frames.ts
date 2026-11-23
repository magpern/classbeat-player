// Fixed-frame rules of the mark gate, pure (mark-gate.ts keeps the ledger): which switch beat counts as a fixed frame, and how a time
// is kept off the fixed frames.
import { MARK_GAP_MS, frameAt } from "../../../player/scene/model/src/flash-marks.ts";
import type { FixedFrame } from "../../../player/scene/model/src/flash-marks.ts";
import type { MarkContext } from "./mark-gate.ts";
import type { RoomModel } from "./model.ts";

/** A clock that reports an interval's end this early (or this late) still counts as that change, not a jump. */
export const NATURAL_MS = 100;
/** A move of the class clock that differs from the wall time by more than this is a seek or a jump. */
const JUMP_MS = 1500;

/** What the last offer saw: the model, when (on the frame grid) and the fixed frames it announced. */
export interface Seen {
  readonly model: RoomModel;
  readonly atMs: number;
  readonly ctx: MarkContext;
}

/** The interval's end that the last offer expected has come, and the clock did not jump to get there. */
export function jumped(before: Seen | null, model: RoomModel, nowMs: number): boolean {
  if (!before) return false;
  const expected = before.model.moving ? nowMs - before.atMs : 0;
  return Math.abs(model.classMs - before.model.classMs - expected) > JUMP_MS;
}
export function natural(before: Seen | null, model: RoomModel, nowMs: number): boolean {
  if (!before || before.ctx.changeAtMs === null || before.model.intervalKey === model.intervalKey) return false;
  return nowMs >= before.ctx.changeAtMs - NATURAL_MS && !jumped(before, model, nowMs);
}

/**
 * The count's switch beat as a fixed frame: a beat under 500 ms from the interval's change frame, before it or after it, is not one of
 * its own. The count's change joins the change frame (before it) or waits 500 ms after it (after it): nothing is drawn on the beat, so
 * no outside change may ride the beat and be drawn there, too close to the change frame (P1).
 */
export function switchFrame(ctx: { readonly changeAtMs: number | null; readonly switchAtMs: number | null }): number | null {
  const { changeAtMs: change, switchAtMs: sw } = ctx;
  return sw !== null && change !== null && Math.abs(sw - change) < MARK_GAP_MS - 1 ? null : sw;
}

/**
 * Keeps a time off the fixed frames: one within 500 ms of a fixed frame (in another frame) is not taken. If the fixed frame
 * is ahead of it, it joins that frame (`rides`); if it is behind, it moves to 500 ms after it (on `grid`). P1: no mark makes a fixed frame give way.
 */
export function awayFromFixed(fixed: readonly FixedFrame[], at: number, grid: (ms: number) => number): { at: number; rides: number | null } {
  let t = at;
  for (let i = 0; i < fixed.length + 1; i += 1) {
    const f = fixed.find((x) => Math.abs(x.atMs - t) < MARK_GAP_MS - 1 && Math.abs(x.atMs - t) > 1e-6);
    if (!f) return { at: t, rides: null };
    if (f.atMs > t) return { at: f.atMs, rides: f.atMs };
    t = grid(f.atMs + MARK_GAP_MS);
  }
  return { at: t, rides: null };
}

/**
 * The first time at or after `from` that is 500 ms from every fixed frame and every mark in `marks`. Too close ahead of a fixed frame it
 * joins that frame (`rides`), as `awayFromFixed` says. Used to seat a change again when the frame it rode has gone.
 */
export function earliestAway(fixed: readonly FixedFrame[], marks: readonly number[], from: number, grid: (ms: number) => number): { at: number; rides: number | null } {
  let at = from;
  for (let i = 0; i < 8; i += 1) {
    const away = awayFromFixed(fixed, at, grid);
    if (away.rides !== null) return away;
    at = away.at;
    // A mark in the very frame is shared, not avoided (two changes in one frame are one mark).
    const m = marks.find((x) => Math.abs(x - at) < MARK_GAP_MS - 1 && Math.abs(x - at) > 1e-6);
    if (m === undefined) return { at, rides: null };
    at = grid(m + MARK_GAP_MS);
  }
  return { at, rides: null };
}

/** What `reseat` needs of a change reserved for an outside draw. */
export interface Seatable {
  readonly at: number;
  readonly rides: boolean;
  readonly frame: number | null;
}
export interface Reseated {
  readonly entry: Seatable;
  readonly at: number;
  readonly rides: boolean;
  readonly frame: number | null;
}

/**
 * Reserved changes the fixed frames of the newest offer no longer fit: one riding a frame the clock no longer has (a pause or a seek took
 * it away). It is seated again as early as the real gap allows, off the fixed frames and the other marks, or riding the frame that is now
 * ahead of it. Changes at one time are one mark and move together. Pure: the caller applies the result.
 */
export function reseat(entries: readonly Seatable[], kept: readonly FixedFrame[], marks: readonly number[], nowMs: number, lastMark: number, frameMs: number): Reseated[] {
  const grid = (ms: number): number => frameAt(ms, frameMs);
  const early = Math.max(grid(nowMs), grid(lastMark + MARK_GAP_MS));
  const gone = (o: Seatable): boolean => o.rides && o.frame !== null && !kept.some((f) => Math.abs(f.atMs - grid(o.frame as number)) < 3 * frameMs);
  const stale = entries.filter(gone);
  const out: Reseated[] = [];
  for (const o of stale) {
    if (out.some((r) => r.entry === o)) continue;
    const group = stale.filter((x) => Math.abs(x.at - o.at) < 1e-6);
    const others = [...entries.filter((x) => !group.includes(x)).map((x) => grid(x.at)), ...marks];
    const seat = earliestAway(kept, others, early, grid);
    for (const g of group) {
      if (seat.rides !== null) out.push({ entry: g, at: Math.max(seat.rides + NATURAL_MS, grid(lastMark + MARK_GAP_MS)), rides: true, frame: seat.rides });
      else out.push({ entry: g, at: Math.min(g.at, seat.at), rides: false, frame: null });
    }
  }
  return out;
}
