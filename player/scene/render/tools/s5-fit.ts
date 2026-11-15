// S5 on rendered pixels (scene.md "Colour: two hues, never a mix"): every pixel of the rig is `a x T + w x white`
// in linear light, `a, w >= 0`, T one allowed zone token. `FIT_SOURCE` is the check as plain JavaScript, so the
// browser run (tools/flash-shots.ts) evaluates exactly what the unit tests (test/s5-fit.test.ts) do: decode the
// 8-bit sRGB pixel to linear light, fit `a` and `w` by least squares (the unconstrained solution, else the two
// edges `a = 0` and `w = 0`), encode the fit back to 8-bit sRGB, and pass the pixel if every channel is within
// 1 code value of it for one of the allowed tokens. Not part of src/: it reads pixels, and the scene never does.

export const FIT_SOURCE = `(function () {
  const dec = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const enc = (l) => { const c = Math.min(1, Math.max(0, l)); return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255); };
  /** A token's colour, 0xRRGGBB, as linear light. */
  const linear = (hex) => [dec(hex >> 16 & 255), dec(hex >> 8 & 255), dec(hex & 255)];
  /** Whether the pixel (8-bit sRGB) is a x token + w x white for one of the linear \`tokens\`, within \`tolerance\` code values. */
  const fits = (r, g, b, tokens, tolerance) => {
    const p = [dec(r), dec(g), dec(b)];
    const p1 = p[0] + p[1] + p[2];
    for (const T of tokens) {
      const tt = T[0] * T[0] + T[1] * T[1] + T[2] * T[2], t1 = T[0] + T[1] + T[2], pt = p[0] * T[0] + p[1] * T[1] + p[2] * T[2];
      const det = tt * 3 - t1 * t1;
      let best = null;
      const tryIt = (a, w) => {
        if (!(a >= 0) || !(w >= 0)) return;
        const e = [a * T[0] + w, a * T[1] + w, a * T[2] + w];
        const res = (e[0] - p[0]) ** 2 + (e[1] - p[1]) ** 2 + (e[2] - p[2]) ** 2;
        if (best === null || res < best.res) best = { e, res };
      };
      if (Math.abs(det) > 1e-12) tryIt((pt * 3 - t1 * p1) / det, (tt * p1 - t1 * pt) / det);
      tryIt(0, p1 / 3);
      tryIt(pt / tt, 0);
      if (best !== null && Math.abs(enc(best.e[0]) - r) <= tolerance && Math.abs(enc(best.e[1]) - g) <= tolerance && Math.abs(enc(best.e[2]) - b) <= tolerance) return true;
    }
    return false;
  };
  return { dec, enc, linear, fits };
})()`;

export interface Fit {
  readonly dec: (c: number) => number;
  readonly enc: (l: number) => number;
  readonly linear: (hex: number) => number[];
  readonly fits: (r: number, g: number, b: number, tokens: readonly (readonly number[])[], tolerance: number) => boolean;
}
/** The check, built from the same source the browser evaluates. */
export const makeFit = (): Fit => (0, eval)(FIT_SOURCE) as Fit;

/** The spec's tolerance: 1 code value on every channel. */
export const TOLERANCE = 1;
