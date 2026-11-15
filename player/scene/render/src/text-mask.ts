// The dark-under-text mask (scene.md S2) as data for the scene's one shader: for each text line the box grown by
// 1.2 vh and faded over 3 vh, in window-height units with y up. The shader scales a pixel's colour, in linear
// light, so its luminance is at most the cap inside the boxes (a scale keeps the token: the pixel is still
// `a x token + w x white`). The boxes come from the text layer's measured line boxes; the numbers and the
// geometry are in text-mask-calc.ts. Light only: the mask moves nothing (rules 4 and 5).

import { Vector3 } from "three";
import type { TextBox } from "./text-box.ts";
import { CAP_MARGIN, MAX_BOXES, maskBoxes } from "./text-mask-calc.ts";

export class TextMask {
  /** The boxes' lower-left (l, b) and upper-right (r, t) corners, the shader's uniform arrays. */
  readonly cornerA: Vector3[] = Array.from({ length: MAX_BOXES }, () => new Vector3());
  readonly cornerB: Vector3[] = Array.from({ length: MAX_BOXES }, () => new Vector3());
  /** The luminance the mask holds the light to: the cap with the margin (0.075 of 0.08). */
  readonly level: number;
  count = 0;
  on = 1;

  constructor(cap: number) {
    this.level = cap * CAP_MARGIN;
  }

  /** The text boxes now, in CSS pixels on a window `width` by `height`. */
  set(boxes: readonly TextBox[], _width: number, height: number): void {
    const mask = maskBoxes(boxes, height);
    this.count = mask.length;
    mask.forEach((m, i) => {
      this.cornerA.at(i)?.set(m.l, m.b, 0);
      this.cornerB.at(i)?.set(m.r, m.t, 0);
    });
  }

  /** Off only in the test that shows what the scene's light is without it. */
  setEnabled(on: boolean): void {
    this.on = on ? 1 : 0;
  }
}
