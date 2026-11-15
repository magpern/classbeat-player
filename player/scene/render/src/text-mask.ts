// The dark-under-text mask (scene.md S2), drawn last over the scene: for each text line a quad that
// covers its box grown by 1.2 vh and faded over 3 vh, and writes the lower of what is there and a
// level (`MinEquation`), the level easing from 1 to the cap inside the box. So the light under the
// text is clamped to the cap whatever the rig draws (a beam, the haze, the white burst), and it
// still shows there, dimmed. Quads overlap with `min`, which is the largest weight of any box. The
// boxes come from the text layer's measured line boxes; the numbers and the geometry are in
// text-mask-calc.ts. Light only: the mask moves nothing (rules 4 and 5).

import { Group, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import type { TextBox } from "./text-box.ts";
import { FADE, GROW, MAX_BOXES, maskBoxes, maskLevel, maskQuad } from "./text-mask-calc.ts";

/** three.js's `CustomBlending` and `MinEquation`, as numbers: the import allowlist (eslint.config.js) names neither, and test/text-mask.test.ts pins both to three's own values. */
export const CUSTOM_BLENDING = 5;
export const MIN_EQUATION = 103;

const vertex = `uniform vec4 uQuad;
uniform float uAspect;
varying vec2 vP;
void main() {
  vec2 clip = uQuad.xy + position.xy * 2.0 * uQuad.zw;
  vP = (clip * 0.5 + 0.5) * vec2(uAspect, 1.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;
const fragment = `uniform vec4 uBox;
uniform float uLevel;
uniform float uOn;
varying vec2 vP;
void main() {
  vec2 out2 = max(uBox.xy - vP, vP - uBox.zw);
  float d = max(out2.x, out2.y);
  float w = 1.0 - smoothstep(${GROW.toFixed(4)}, ${(GROW + FADE).toFixed(4)}, d);
  float level = mix(1.0, uLevel, w * uOn);
  gl_FragColor = vec4(level, level, level, 1.0);
}`;

export class TextMask {
  readonly group = new Group();
  private readonly meshes: Mesh[] = [];
  private readonly level: number;
  private on = 1;
  private boxes: readonly TextBox[] = [];
  private size = { width: 1, height: 1 };

  constructor(cap: number) {
    this.level = maskLevel(cap);
    const geometry = new PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_BOXES; i++) {
      const material = new ShaderMaterial({
        uniforms: { uQuad: { value: [0, 0, 1, 1] }, uBox: { value: [0, 0, 0, 0] }, uAspect: { value: 16 / 9 }, uLevel: { value: this.level }, uOn: { value: 1 } },
        vertexShader: vertex, fragmentShader: fragment,
        transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
        blending: CUSTOM_BLENDING, blendEquation: MIN_EQUATION,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1000;
      mesh.visible = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /** The text boxes now, in CSS pixels on a window `width` by `height`. */
  set(boxes: readonly TextBox[], width: number, height: number): void {
    this.boxes = boxes;
    this.size = { width, height };
    this.layout();
  }

  /** Off only in the test that shows what the scene's light is without it. */
  setEnabled(on: boolean): void {
    this.on = on ? 1 : 0;
    this.layout();
  }

  private layout(): void {
    const aspect = this.size.width / Math.max(1, this.size.height);
    const mask = maskBoxes(this.boxes, this.size.height);
    this.meshes.forEach((mesh, i) => {
      const m = mask.at(i);
      mesh.visible = m !== undefined;
      if (m === undefined) return;
      const q = maskQuad(m, aspect);
      const material = mesh.material as ShaderMaterial;
      material.uniforms.uQuad!.value = [q.cx, q.cy, q.hx, q.hy];
      material.uniforms.uBox!.value = [m.l, m.b, m.r, m.t];
      material.uniforms.uAspect!.value = aspect;
      material.uniforms.uOn!.value = this.on;
    });
  }
}
