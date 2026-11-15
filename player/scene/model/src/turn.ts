// The turn-rate limiter (scene.md "How a beam turns", S7). A beam's drawn direction moves toward
// its target along the shortest turn, never faster than the limit and never past the target. The
// angle is the real angle between the two directions (pan and tilt together), measured on unit
// vectors. Inputs: the drawn direction, the target and the step in degrees; no interval, zone,
// time or position reaches it (rule 4). Pure.

import type { Direction } from "./beams.ts";

type Vec = readonly [number, number, number];
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Unit vector of a direction: pan to the right, tilt down from the horizontal. */
function toVec({ pan, tilt }: Direction): Vec {
  return [Math.sin(pan * RAD) * Math.cos(tilt * RAD), -Math.sin(tilt * RAD), Math.cos(pan * RAD) * Math.cos(tilt * RAD)];
}
function fromVec([x, y, z]: Vec): Direction {
  return { pan: Math.atan2(x, z) * DEG, tilt: -Math.asin(Math.max(-1, Math.min(1, y))) * DEG };
}
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** The angle between two directions, in degrees (0 to 180). */
export function angleBetween(a: Direction, b: Direction): number {
  const [va, vb] = [toVec(a), toVec(b)];
  const c = cross(va, vb);
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(va, vb)) * DEG;
}

/**
 * One step of at most `maxDegrees` from `drawn` toward `target`. When the target is within reach
 * the result is the target itself (no overshoot, no creep); when it is already there, nothing
 * changes. A non-positive or non-finite step does not turn.
 */
export function limitTurn(drawn: Direction, target: Direction, maxDegrees: number): Direction {
  const angle = angleBetween(drawn, target);
  if (angle === 0 || !(maxDegrees > 0)) return drawn;
  if (angle <= maxDegrees) return target;
  const [a, b] = [toVec(drawn), toVec(target)];
  const theta = angle * RAD;
  if (Math.sin(theta) < 1e-9) return { pan: drawn.pan + maxDegrees, tilt: drawn.tilt }; // straight back: pick a side
  const [wa, wb] = [Math.sin(theta - maxDegrees * RAD) / Math.sin(theta), Math.sin(maxDegrees * RAD) / Math.sin(theta)];
  return fromVec([wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]]);
}
