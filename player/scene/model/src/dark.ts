// A sweep moves in black (scene.md "A sweep moves in black", "A burst cuts a sweep's window"): on a turn's first frame (the off-step)
// every turning beam's light steps to 0 in one frame, the beams turn dark, and at the on-step, the later of the beams' arrival and the off-step
// plus 1 s + 1 frame, the light steps back. The steps of two spans are at least 1 s + 1 frame apart, or the spans join into one: so no 1 s
// window holds two steps. The plan is a function of the song's turns as planned without any burst (rule 4); a placed burst may only move a
// step into its own rise frame. Times are milliseconds on the class clock; `frameMs` is the refresh period. Pure.

export interface Turn {
  /** The turn's first frame. */
  readonly startMs: number;
  /** The frame every beam is on its target, as the pure model has it (never before `startMs`). */
  readonly arrivalMs: number;
  /** A gather's beams hold still 1 s before the drop: the light is back by then, on target or not ("never later than its hold-still"). */
  readonly capMs?: number;
}
export interface DarkSpan {
  /** The off-step: the first turn's first frame. */
  readonly offMs: number;
  /** The on-step. */
  readonly onMs: number;
  /** The first frame of the span's last turn: the beams are not back before it. */
  readonly lastStartMs: number;
  /** Set where every turn of the span is capped: the on-step is then fixed, on target or not. */
  readonly forceOnMs?: number;
}
export interface Decay { readonly fromMs: number; readonly toMs: number }

/** The least dark: 1 s + 1 frame, between an off-step and its on-step, and between one span's on-step and the next one's off-step. */
export const minDarkMs = (frameMs: number): number => 1000 + frameMs;
/** The sway's and steady light's clocks are held from this long before the off-step to this long after the on-step. */
export const HOLD_AROUND_MS = 1000;

const EPS = 1e-6;

/**
 * The spans of a set of turns: each is dark from its first frame to the later of its arrival and 1 s + 1 frame after it; turns that
 * overlap, or whose gap (one span's on-step to the next one's off-step) is under 1 s + 1 frame, join into one span, chained across any
 * number of turns. The join only lengthens the dark; no turn moves.
 */
export function planSpans(turns: readonly Turn[], frameMs: number): DarkSpan[] {
  const least = minDarkMs(frameMs);
  const out: DarkSpan[] = [];
  for (const t of [...turns].sort((a, b) => a.startMs - b.startMs)) {
    const capped = t.capMs !== undefined && t.arrivalMs > t.capMs;
    const on = Math.max(Math.min(t.arrivalMs, t.capMs ?? Infinity), t.startMs + least);
    const last = out.at(-1);
    if (last !== undefined && t.startMs - last.onMs < least - EPS) {
      const force = last.forceOnMs !== undefined && capped ? Math.max(last.forceOnMs, on) : undefined;
      out[out.length - 1] = { offMs: last.offMs, onMs: Math.max(last.onMs, on, last.offMs + least), lastStartMs: Math.max(last.lastStartMs, t.startMs), ...(force === undefined ? {} : { forceOnMs: force }) };
    } else out.push({ offMs: t.startMs, onMs: on, lastStartMs: t.startMs, ...(capped ? { forceOnMs: on } : {}) });
  }
  return out;
}

/** Where the sway's motion phase and steady light's clock are held for a span: 1 s before the off-step to 1 s after the on-step. */
export const holdAround = (s: { readonly offMs: number; readonly onMs: number }): Decay => ({ fromMs: s.offMs - HOLD_AROUND_MS, toMs: s.onMs + HOLD_AROUND_MS });

export type SpanCut =
  | { readonly kind: "clear" }
  /** The decay lies in the span: the burst is skipped (steps e and f). */
  | { readonly kind: "overlaps" }
  /** B7: the on-step would come under 1 s + 1 frame before the decay's first frame; the light comes on in the rise frame. */
  | { readonly kind: "b7"; readonly onMs: number }
  /** B8: the turn's first frame comes under 1 s after the decay's last; the beams go dark in the rise frame and come on 1 s + 1 frame after the decay. */
  | { readonly kind: "b8"; readonly offMs: number; readonly onMs: number };

/** What a placed burst does to a span (the rise frame is the frame before the decay's first, already a mark). Only light moves; no turn does. */
export function cutSpan(span: { readonly offMs: number; readonly onMs: number }, decay: Decay, frameMs: number): SpanCut {
  const rise = decay.fromMs - frameMs;
  if (span.offMs < decay.toMs - EPS && span.onMs > rise + EPS) return { kind: "overlaps" };
  if (span.onMs <= rise + EPS && decay.fromMs - span.onMs < minDarkMs(frameMs) - EPS) return { kind: "b7", onMs: rise };
  if (span.offMs >= decay.toMs - EPS && span.offMs - decay.toMs < 1000 - EPS) return { kind: "b8", offMs: rise, onMs: Math.max(span.onMs, decay.toMs + minDarkMs(frameMs)) };
  return { kind: "clear" };
}
