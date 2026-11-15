// The hue cross and the energy ramp at an interval change (scene.md "Colour: two hues, never a mix"). It
// lands on the change `t0`: it runs in the 700 ms that end there, as a wipe from the right edge toward the
// gel. The front is a vertical line at x = 1 - e(s), `x` the share of the width from the left and `e` the
// ease-out of `--m-change`; each source takes the next token when the front passes it, in one frame, at
// constant luminance (a flag, no blend). One linear ramp over the same time takes every light's energy
// from the zone left to the zone entered. A seek, a jump, a frozen rig and the still rig have no cross.
// Pure: time comes in as the time to the change.

export const CROSS_MS = 700;
export interface CrossLook {
  /** The front's place as a share of the width from the left; a source at or right of it has the next token. 2 when there is no cross. */
  readonly front: number;
  /** 0 to 1: how far the energy has got from the zone left to the zone entered, linear. */
  readonly ramp: number;
}
export const NO_CROSS: CrossLook = { front: 2, ramp: 0 };

/** The ease-out of `--m-change`: fast to start, slow to end. */
export const easeOut = (p: number): number => 1 - (1 - Math.min(1, Math.max(0, p))) ** 3;

/**
 * The cross at `msToChange` before the next change (null at the last interval). A change less than 700 ms after the
 * previous one shortens the cross: it never starts before that change.
 */
export function crossLook(msToChange: number | null, msSincePrevious: number, crossMs = CROSS_MS): CrossLook {
  if (msToChange === null) return NO_CROSS;
  // The interval's own length (from the previous change to the next) is fixed, so the span is too: it does not grow as the interval goes on.
  const span = Math.min(crossMs, Math.max(0, msSincePrevious) + msToChange);
  if (!(span > 0) || msToChange <= 0 || msToChange > span) return NO_CROSS;
  const s = 1 - msToChange / span;
  return { front: 1 - easeOut(s), ramp: s };
}

/** Sees a seek: a cross the clock jumped into is left out, until the window it landed in is over. */
export class CrossGate {
  private classMs = 0;
  private jumped = false;
  private first = true;

  filter(classMs: number, look: CrossLook): CrossLook {
    if (!this.first && Math.abs(classMs - this.classMs) > 1000) this.jumped = true;
    [this.classMs, this.first] = [classMs, false];
    if (look === NO_CROSS || look.front >= 2) this.jumped = false;
    return this.jumped ? NO_CROSS : look;
  }
}
