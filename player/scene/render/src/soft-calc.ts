// The softening of the mock-up (scene.md "Quality levels", mock-up scene-rig.html): a beam's edge
// fades out to nothing at its silhouette, and a wall dot is a round soft light, not a hard square.
// These are the numbers the shaders are built from, and the same functions in plain code so a test
// can show the edge has no step. Haze and brightness shares sit here too. Pure.

/** A beam: how much of the cone, from its silhouette inward, fades (the cone seen square-on is 1, side-on 0). */
export const BEAM_SOFT_EDGE = 0.6;
/** A wall dot: full brightness inside this share of its radius, nothing at the edge (the mock-up's smoothstep(.3, .1, r)). */
export const DOT_INNER = 0.33;
export const DOT_OUTER = 1;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The beam's brightness share where the surface faces the viewer by `facing` (0 at the silhouette, 1 square-on). */
export function beamEdge(facing: number): number {
  return smoothstep(0, BEAM_SOFT_EDGE, facing);
}

/** A wall dot's brightness share at `distance` from its centre, as a share of its radius (0 centre, 1 edge). */
export function dotFalloff(distance: number): number {
  return 1 - smoothstep(DOT_INNER, DOT_OUTER, distance);
}

/**
 * The share of the zone's ambient glow each haze layer carries. They add up to 1 at every quality
 * level, so High (two layers) glows as the spec's table says and not 1.7 times it.
 */
export function hazeShares(layers: 1 | 2): readonly [number, number] {
  return layers === 2 ? [0.6, 0.4] : [1, 0];
}
