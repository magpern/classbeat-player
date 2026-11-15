// Haze: slowly drifting density in the zone's colour that the beams seem to light. One or two soft
// additive layers, by quality level. It is brightness only: a level, a colour and a drift.

import { AdditiveBlending, Color, Mesh, PlaneGeometry, ShaderMaterial } from "three";

const vertex = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fragment = `uniform vec3 uColor;
uniform float uLevel;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float falloff = smoothstep(0.7, 0.0, length(p * vec2(1.0, 1.5)));
  float drift = 0.75 + 0.25 * sin(p.x * 7.0 + uTime * 0.15) * sin(p.y * 5.0 - uTime * 0.1);
  gl_FragColor = vec4(uColor * uLevel * falloff * drift, 1.0);
  #include <colorspace_fragment>
}`;

export class HazeLayer {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(depth: number, size: number) {
    this.material = new ShaderMaterial({
      uniforms: { uColor: { value: new Color() }, uLevel: { value: 0 }, uTime: { value: 0 } },
      vertexShader: vertex, fragmentShader: fragment,
      transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, toneMapped: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(size * 1.8, size), this.material);
    this.mesh.position.z = depth;
    this.mesh.renderOrder = -1;
  }

  set(hex: number, level: number, seconds: number, visible: boolean): void {
    this.mesh.visible = visible;
    (this.material.uniforms.uColor!.value as Color).setHex(hex);
    this.material.uniforms.uLevel!.value = level;
    this.material.uniforms.uTime!.value = seconds;
  }
}
