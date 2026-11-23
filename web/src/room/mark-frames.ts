// Fixed-frame rules of the mark gate, pure (mark-gate.ts keeps the ledger): which switch beat counts as a fixed frame, and how a time
// is kept off the fixed frames.
import { MARK_GAP_MS } from "../../../player/scene/model/src/flash-marks.ts";
import type { FixedFrame } from "../../../player/scene/model/src/flash-marks.ts";

/**
 * The count's switch beat as a fixed frame: a beat under 500 ms before the interval's change frame is not one of its own. The count's
 * change joins the change frame (nothing is drawn on the beat), so no outside change may ride the beat and be drawn there, 500 ms ahead
 * of the change frame.
 */
export function switchFrame(ctx: { readonly changeAtMs: number | null; readonly switchAtMs: number | null }): number | null {
  const { changeAtMs: change, switchAtMs: sw } = ctx;
  return sw !== null && change !== null && sw < change && change - sw < MARK_GAP_MS - 1 ? null : sw;
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
