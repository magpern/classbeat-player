// The 700 ms colour cross at an interval change (scene.md "States", `--m-change`). The front truss,
// the floor uplights and the haze go from the old zone's colour to the new one's. S5 and rule 7:
// the cross is always between exactly two allowed hues, the zone just left and the zone now in, and
// the rig draws each of the two as itself (a pure token) and blends only inside the shader. There
// is no third hue to hold, so the type carries two hues and a weight, never a mixed colour.
// Only a change to the next interval crosses; a seek, reduced motion and a frozen rig are instant.
// Pure: time comes in as the frame time.

import type { RigHue } from "../../model/src/index.ts";

/** What is drawn for the front colour: `to` is the colour now, `from` the one being left, `k` 0 to 1 how far over. */
export interface Cross {
  readonly from: RigHue;
  readonly to: RigHue;
  readonly k: number;
}

export const DEFAULT_CROSS_MS = 700;

export const sameHue = (a: RigHue, b: RigHue): boolean => (a.kind === "white" ? b.kind === "white" : b.kind === "zone" && a.zone === b.zone);

/** The cross's easing: out-cubic, as `--m-change`'s curve (fast start, slow end). */
export function eased(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return 1 - (1 - p) ** 3;
}

export interface CrossInput {
  /** Index of the interval the class clock is in. */
  readonly interval: number;
  /** The colour of the front truss now (the planned zone's, or white in the finished house). */
  readonly front: RigHue;
  readonly dtMs: number;
  /** Instant: reduced motion, or a frozen rig. */
  readonly instant: boolean;
  /** `--m-change` in ms; 0 means no cross. */
  readonly crossMs: number;
}

export class ColourCross {
  private interval = -1;
  private to: RigHue | null = null;
  private from: RigHue | null = null;
  private progress = 1;

  update(a: CrossInput): Cross {
    const next = this.to === null || a.interval !== this.interval + 1 ? false : !sameHue(this.to, a.front);
    if (next && !a.instant && a.crossMs > 0) {
      // A second change before the first is over starts from the colour that is nearer.
      this.from = this.progress >= 0.5 ? this.to : (this.from ?? this.to);
      this.progress = 0;
    } else if (this.to === null || !sameHue(this.to, a.front)) {
      this.from = a.front;
      this.progress = 1;
    }
    this.to = a.front;
    this.interval = a.interval;
    if (this.progress < 1) this.progress = a.instant || a.crossMs <= 0 ? 1 : Math.min(1, this.progress + a.dtMs / a.crossMs);
    const from = this.from ?? a.front;
    return this.progress >= 1 ? { from: a.front, to: a.front, k: 1 } : { from, to: a.front, k: eased(this.progress) };
  }
}
