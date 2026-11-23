// The text layer as an overlay, from two screenshots of it with the scene's canvas hidden (tools/flash-shots.ts): over black
// (each pixel is its colour times its opacity) and over white (that plus what the white shows through), so the opacity is
// 1 - (white - black) / 255 and a canvas pixel C under it shows as `black + (1 - opacity) * C`, the browser's own blend.

import type { Pixels } from "./png.ts";

/** RGBA per pixel: the colour over black in R, G, B and the opacity (0 to 255) in A. */
export function overlayOf(black: Pixels, white: Pixels): Uint8Array {
  if (black.width !== white.width || black.height !== white.height) throw new Error("the two screenshots differ in size");
  const out = new Uint8Array(black.data.length);
  for (let i = 0; i < black.data.length; i += 4) {
    const through = ((white.data[i]! - black.data[i]!) + (white.data[i + 1]! - black.data[i + 1]!) + (white.data[i + 2]! - black.data[i + 2]!)) / 3 / 255;
    out[i] = black.data[i]!;
    out[i + 1] = black.data[i + 1]!;
    out[i + 2] = black.data[i + 2]!;
    out[i + 3] = Math.round(255 * (1 - Math.min(1, Math.max(0, through))));
  }
  return out;
}

/** A canvas pixel under an overlay pixel, as the page blends it (the same arithmetic as the probe's `measure`), for the test. */
export function blend(over: readonly [number, number, number, number], under: readonly [number, number, number]): [number, number, number] {
  const through = 1 - over[3] / 255;
  return [Math.min(255, over[0] + through * under[0]), Math.min(255, over[1] + through * under[1]), Math.min(255, over[2] + through * under[2])];
}
