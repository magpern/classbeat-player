// When the beams are dark (scene.md "A sweep moves in black"): from a span's off-step, its turn's first frame, until its on-step, the later of
// the frame every beam is on its target and 1 s + 1 frame after the off-step; one off-step and one on-step for a span of joined turns. A placed
// burst may move a step into its own rise frame, which is already a mark (B7: the light comes on in it; B8: the beams go dark in it, and come
// on 1 s + 1 frame after the decay). The motion phase and steady light's clock are held from 1 s before the off-step to 1 s after the on-step,
// by the span as planned without any burst. An unforeseen cause keeps the beams dark if they are, and starts a span of its own on the turn's first
// frame, 2 s after it. Nothing here touches a direction: only light (rule 4, S7). The state it keeps is what has been lit again.

import type { CutRecord, DarkSpan } from "../../model/src/index.ts";
import { HOLD_AROUND_MS, minDarkMs } from "../../model/src/index.ts";
import { FRAME_MS } from "./marks-calc.ts";

const key = (offMs: number): number => Math.round(offMs);
/** A span that has not been lit again this long after its planned on-step is lit anyway: the turn did not end where the plan said (a guard, not a rule). */
const GIVE_UP_MS = 6000;

export interface GateFrame {
  readonly classMs: number;
  /** The song's planned spans, as planned without any burst. */
  readonly spans: readonly DarkSpan[];
  /** What the placed bursts did to them. */
  readonly cuts: readonly CutRecord[];
  /** Every beam is on its target (drawn equals target, none held back by a hold or a pause). */
  readonly onTarget: boolean;
  /** An unforeseen cause came on this frame, and the class-clock time its hold ends (the turn's first frame). */
  readonly cause: { readonly turnStartMs: number } | null;
}

export class DarkGate {
  private readonly lit = new Map<number, number>(); // the spans that are over: planned off-step -> the frame they were lit again (or given up)
  private readonly plain = new Map<number, number>(); // when each span is over as it would be without any burst: the hold runs to 1 s after it
  private readonly entered = new Set<number>(); // the spans the beams have actually gone dark in: a seek into one does not
  private readonly causes = new Map<number, number>(); // spans an unforeseen cause made: off-step -> the turn's first frame
  private readonly extended = new Map<number, number>(); // a span a cause came in: off-step -> the later turn's first frame
  private first = true;

  /** Every span in play: the planned ones and the causes'. */
  private all(spans: readonly DarkSpan[]): DarkSpan[] {
    const made = [...this.causes].map(([offMs, last]) => ({ offMs, onMs: last + 3500, lastStartMs: last }));
    return [...spans, ...made].map((s) => ({ ...s, lastStartMs: Math.max(s.lastStartMs, this.extended.get(key(s.offMs)) ?? 0) }));
  }

  /** The motion phase and steady light are held: 1 s before an off-step to 1 s after the on-step. Asked before the frame is stepped. */
  held(classMs: number, spans: readonly DarkSpan[]): boolean {
    // As planned without any burst: a cut moves a step into the rise frame, never the hold, so no direction depends on a burst (rule 4).
    return this.all(spans).some((s) => classMs >= s.offMs - HOLD_AROUND_MS && classMs < (this.plain.get(key(s.offMs)) ?? s.onMs + GIVE_UP_MS) + HOLD_AROUND_MS);
  }

  /** The beat-like light (lift, pulse, build haze step) is held with the sway round a drop's gather: from 1 s before its off-step to 1 s after its on-step, as planned without any burst. */
  beatHeld(classMs: number, spans: readonly DarkSpan[]): boolean {
    return this.all(spans).some((s) => s.holdsBeat === true && classMs >= s.offMs - HOLD_AROUND_MS && classMs < (this.plain.get(key(s.offMs)) ?? s.onMs + GIVE_UP_MS) + HOLD_AROUND_MS);
  }

  /** Whether the beams are dark on this frame. */
  step(f: GateFrame): boolean {
    const t = f.classMs;
    if (f.cause !== null) {
      if (this.first) this.first = false;
      for (const [k, v] of this.lit) if (v > t) { this.lit.delete(k); this.plain.delete(k); } // a seek back: what was lit later is to come again
      const active = this.all(f.spans).find((s) => this.entered.has(key(s.offMs)) && !this.lit.has(key(s.offMs)));
      for (const s of f.spans) if (!this.lit.has(key(s.offMs)) && (active === undefined || key(s.offMs) !== key(active.offMs)) && s.offMs < f.cause.turnStartMs) { this.lit.set(key(s.offMs), t); this.plain.set(key(s.offMs), t); } // no turn in the hold
      if (active !== undefined) this.extended.set(key(active.offMs), f.cause.turnStartMs);
      else this.causes.set(key(f.cause.turnStartMs), f.cause.turnStartMs);
    }
    if (this.first) { // the first frame starts on the targets: a span already running was never dark
      this.first = false;
      for (const s of f.spans) if (s.offMs <= t) { this.lit.set(key(s.offMs), t); this.plain.set(key(s.offMs), t); }
    }
    const least = minDarkMs(FRAME_MS);
    let dark = false;
    for (const s of this.all(f.spans)) {
      const k = key(s.offMs);
      const forced = s.forceOnMs !== undefined && t >= s.forceOnMs;
      if (!this.plain.has(k) && t >= s.offMs + least && t >= s.lastStartMs && (f.onTarget || forced)) this.plain.set(k, t); // as without any burst
      if (this.lit.has(k)) continue;
      const cut = f.cuts.find((c) => Math.abs(c.planned.fromMs - s.offMs) < 1.5);
      const off = cut?.kind === "b8" ? cut.offMs : s.offMs;
      if (t < off) continue;
      const earliest = cut === undefined ? s.offMs + least : cut.onMs; // B7: the rise frame; B8: 1 s + 1 frame after the decay, or the arrival
      if ((t >= earliest && t >= s.lastStartMs && (f.onTarget || forced)) || t >= s.onMs + GIVE_UP_MS) this.lit.set(k, t);
      else { dark = true; this.entered.add(k); }
    }
    for (const [k, v] of this.lit) if (v < t - 60_000) { this.lit.delete(k); this.plain.delete(k); }
    return dark;
  }
}
