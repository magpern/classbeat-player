// The LED wall: 56 x 14 dots far behind everything (depth 26), playing a slow wave and, in the
// zones that have one and where the beat is known, a chase. Its colour is the back hue (it turns
// first on the anticipation, as a wipe from the far side). The wall only draws brightness.

import { AdditiveBlending, Color, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry } from "three";
import { WALL_COLUMNS, wallDot } from "./light-calc.ts";
import type { WallMode } from "./light-calc.ts";

export const WALL_ROWS = 14;
const SPACING_X = 0.72;
const SPACING_Y = 0.78;
const DEPTH = -26;

export class Wall {
  readonly mesh: InstancedMesh;
  private readonly colour = new Color();

  constructor() {
    const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
    this.mesh = new InstancedMesh(new PlaneGeometry(0.36, 0.36), material, WALL_COLUMNS * WALL_ROWS);
    const at = new Object3D();
    for (let r = 0; r < WALL_ROWS; r++) for (let c = 0; c < WALL_COLUMNS; c++) {
      at.position.set((c - (WALL_COLUMNS - 1) / 2) * SPACING_X, 1 + (r - (WALL_ROWS - 1) / 2) * SPACING_Y, DEPTH);
      at.updateMatrix();
      this.mesh.setMatrixAt(r * WALL_COLUMNS + c, at.matrix);
      this.mesh.setColorAt(r * WALL_COLUMNS + c, this.colour.setRGB(0, 0, 0));
    }
    this.mesh.frustumCulled = false;
  }

  /**
   * `hueAt(col)` is the colour of a column (sRGB hex): the front hue, or the back hue for the
   * columns the anticipation wipe has reached; `level` the master brightness.
   */
  update(hueAt: (col: number) => number, mode: WallMode, chaseStep: number | null, seconds: number, level: number, reduced: boolean): void {
    for (let r = 0; r < WALL_ROWS; r++) for (let c = 0; c < WALL_COLUMNS; c++) {
      const v = wallDot(c, r, mode, chaseStep, seconds, reduced) * level;
      this.mesh.setColorAt(r * WALL_COLUMNS + c, this.colour.setHex(hueAt(c)).multiplyScalar(v));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
