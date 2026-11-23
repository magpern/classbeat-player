// S5b on rendered pixels (scene.md S5b "House-look beams"): before the start each of the two beams has a core of at
// least 0.006 relative luminance and at least 15 code values above the haze beside it on the channel of the token's
// strongest primary. `FLOOR_SOURCE` is the check as plain JavaScript, so the browser run (tools/beam-floor-shots.ts)
// evaluates exactly what the unit tests (test/beam-floor.test.ts) do. Not part of src/: it reads pixels.
//
// How a beam is measured. The beam's axis is walked in world steps of 0.5 from its lens, projected by the scene's own
// camera (the shader's pinhole: a point (x, y, z) is at x / (-z tanH aspect), y / (-z tanH) of the frame). A sample is
// kept if it is inside 95 % of the frame and farther than 8 % of the frame's height from the lens (the lens is its own
// highlight, not the beam's core). Its CORE is the brightest pixel of the 3 x 3 around the axis point. The HAZE BESIDE
// the core is sampled at a fixed distance: 3 beam radii (the beam's profile is exp(-d^2 / r^2), so e^-9 of its core
// there), square to the projected axis, on each side that is inside the frame; the darker side counts. A beam passes
// if at EVERY kept sample the core's relative luminance (decoded sRGB, Rec. 709) is at least `MIN_CORE` and its code on
// the token's strongest primary is at least `MIN_ABOVE_HAZE` above the haze pixel's. A beam with no kept sample fails.

/** S5b's numbers. */
export const MIN_CORE = 0.006;
export const MIN_ABOVE_HAZE = 15;
export const HAZE_RADII = 3;
export const LENS_MARGIN = 0.08;
export const FRAME_MARGIN = 0.025;

export const FLOOR_SOURCE = `(function () {
  const dec = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const at = (px, w, x, y) => { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  const lumOf = (p) => 0.2126 * dec(p[0]) + 0.7152 * dec(p[1]) + 0.0722 * dec(p[2]);
  /** The beam's axis, point by point: where it is in the frame (pixels, top left origin), the unit normal to it, and its radius there. */
  const axis = (b, W, H, tanH, base) => {
    const aspect = W / H;
    const project = (t) => {
      const z = b.o[2] + t * b.d[2];
      return { x: ((b.o[0] + t * b.d[0]) / (-z * tanH * aspect) * 0.5 + 0.5) * W, y: (1 - ((b.o[1] + t * b.d[1]) / (-z * tanH) * 0.5 + 0.5)) * H, z };
    };
    const lens = project(0), out = [];
    for (let t = 0.5; t <= 45; t += 0.5) {
      const p = project(t);
      if (!(p.z < -0.5) || p.x < W * ${FRAME_MARGIN} || p.x > W * (1 - ${FRAME_MARGIN}) || p.y < H * ${FRAME_MARGIN} || p.y > H * (1 - ${FRAME_MARGIN})) continue;
      if (Math.hypot(p.x - lens.x, p.y - lens.y) < ${LENS_MARGIN} * H) continue;
      const q = project(t + 0.25), dx = q.x - p.x, dy = q.y - p.y, n = Math.hypot(dx, dy);
      if (!(n > 1e-9)) continue;
      out.push({ x: p.x, y: p.y, nx: -dy / n, ny: dx / n, r: (base + t * b.spread) / (-p.z * tanH) * H / 2 });
    }
    return out;
  };
  /** Per beam: the samples kept, the lowest core luminance, the lowest margin over the haze in codes on \`channel\`. */
  const measure = (px, W, H, beams, tanH, channel, base) => beams.map((b) => {
    let minY = Infinity, minAbove = Infinity, n = 0;
    for (const s of axis(b, W, H, tanH, base)) {
      const cx = Math.round(s.x), cy = Math.round(s.y);
      let best = null;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const p = at(px, W, x, y);
        if (best === null || lumOf(p) > lumOf(best)) best = p;
      }
      let haze = null;
      for (const side of [-1, 1]) {
        const x = Math.round(s.x + side * s.nx * ${HAZE_RADII} * s.r), y = Math.round(s.y + side * s.ny * ${HAZE_RADII} * s.r);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const p = at(px, W, x, y);
        if (haze === null || lumOf(p) < lumOf(haze)) haze = p;
      }
      if (best === null || haze === null) continue;
      n++;
      minY = Math.min(minY, lumOf(best));
      minAbove = Math.min(minAbove, best[channel] - haze[channel]);
    }
    return { n, minY, minAbove };
  });
  return { dec, lumOf, axis, measure };
})()`;

export interface Beam { readonly o: readonly number[]; readonly d: readonly number[]; readonly spread: number }
export interface Measured { readonly n: number; readonly minY: number; readonly minAbove: number }
export interface FloorCheck {
  readonly lumOf: (p: readonly number[]) => number;
  readonly measure: (px: ArrayLike<number>, w: number, h: number, beams: readonly Beam[], tanH: number, channel: number, base: number) => Measured[];
}
/** The check, built from the same source the browser evaluates. */
export const makeFloorCheck = (): FloorCheck => (0, eval)(FLOOR_SOURCE) as FloorCheck;

/** What is wrong with a beam's measure against S5b (empty when it passes). */
export function floorFaults(m: Measured): string[] {
  if (m.n === 0) return ["no sample of the beam's core was found in the frame"];
  const out: string[] = [];
  if (m.minY < MIN_CORE) out.push(`core ${m.minY.toFixed(5)} is under ${MIN_CORE}`);
  if (m.minAbove < MIN_ABOVE_HAZE) out.push(`core is ${m.minAbove} codes above the haze, under ${MIN_ABOVE_HAZE}`);
  return out;
}
