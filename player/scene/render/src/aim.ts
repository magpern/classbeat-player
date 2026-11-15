// The join between the model's directions (pan to the right, tilt down from the horizontal, degrees)
// and three.js: the camera looks down -z, x is right, y is up, so a model vector (x, y, z) is the
// world vector (x, y, -z). Both ways, so a test can read back what the rig actually holds.

import { Quaternion, Vector3 } from "three";
import type { Direction } from "../../model/src/index.ts";

const RAD = Math.PI / 180;
/** A beam's own axis: it points down -z until it is turned. */
export const BEAM_AXIS = new Vector3(0, 0, -1);

export function worldVector({ pan, tilt }: Direction): Vector3 {
  return new Vector3(Math.sin(pan * RAD) * Math.cos(tilt * RAD), -Math.sin(tilt * RAD), -Math.cos(pan * RAD) * Math.cos(tilt * RAD));
}

export function directionOf(v: Vector3): Direction {
  const u = v.clone().normalize();
  return { pan: Math.atan2(u.x, -u.z) / RAD, tilt: -Math.asin(Math.max(-1, Math.min(1, u.y))) / RAD };
}

/** The rotation that turns a beam's axis to `d`. */
export function aimQuaternion(d: Direction, out: Quaternion): Quaternion {
  return out.setFromUnitVectors(BEAM_AXIS, worldVector(d));
}

/** The direction a beam with this rotation points in. */
export function aimedDirection(q: Quaternion): Direction {
  return directionOf(BEAM_AXIS.clone().applyQuaternion(q));
}
