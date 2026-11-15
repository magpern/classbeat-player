// The LED wall: 56 x 14 dots far behind everything (depth 26), playing a slow wave and, in the
// zones that have one and where the beat is known, a chase. Its colour is the back hue (it turns
// first on the anticipation, as a wipe from the far side). The wall only draws brightness. Each dot
// is a round soft light, as in the mock-up, never a hard square.

import { AdditiveBlending, Color, InstancedMesh, Object3D, PlaneGeometry, ShaderMaterial } from "three";
import { WALL_COLUMNS, wallDot } from "./light-calc.ts";
import type { WallMode } from "./light-calc.ts";
import { DOT_INNER, DOT_OUTER } from "./soft-calc.ts";

export const WALL_ROWS = 14;
const SPACING_X = 0.72;
const SPACING_Y = 0.78;
const DEPTH = -26;

// The dot's colour is its instance colour (the dot's hue times its brightness); the quad's distance from its centre gives the round edge.
const vertex = `varying vec3 vColor;
varying vec2 vUv;
void main() {
  vUv = uv;
  vColor = vec3(1.0);
  vec4 at = vec4(position, 1.0);
  #ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
  #endif
  #ifdef USE_INSTANCING
  at = instanceMatrix * at;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * at;
}`;
const fragment = `varying vec3 vColor;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float fall = 1.0 - smoothstep(${DOT_INNER.toFixed(2)}, ${DOT_OUTER.toFixed(2)}, d);
  gl_FragColor = vec4(vColor * fall, 1.0);
  #include <colorspace_fragment>
}`;

export class Wall {
  readonly mesh: InstancedMesh;
  private readonly colour = new Color();

  constructor() {
    const material = new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
    this.mesh = new InstancedMesh(new PlaneGeometry(0.5, 0.5), material, WALL_COLUMNS * WALL_ROWS);
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
