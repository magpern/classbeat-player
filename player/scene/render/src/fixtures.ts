// The 22 moving heads: front truss 8, floor uplights 6, back truss 8 (scene.md "The scene"). Each is
// a lens and a soft additive beam from the lens along its own axis; the rig turns it by the
// model's drawn direction and sets its colour and brightness. Fixed positions, a fixed camera.

import { AdditiveBlending, CircleGeometry, Color, ConeGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, ShaderMaterial } from "three";
import type { Fixture as ModelFixture, Layer } from "../../model/src/index.ts";
import { FIXTURES } from "../../model/src/index.ts";
import { lookup } from "./lookup.ts";
import { BEAM_SOFT_EDGE } from "./soft-calc.ts";

interface LayerSpec { readonly z: number; readonly y: number; readonly span: number; readonly lens: number; readonly beamGain: number }
/** Depths from scene.md: front 16, floor 19, back 23 (camera at 0, looking down -z). The back truss is smaller and dimmer. */
export const LAYERS: Readonly<Record<Layer, LayerSpec>> = {
  front: { z: -16, y: 6.4, span: 11, lens: 0.34, beamGain: 1 },
  floor: { z: -19, y: -7.6, span: 8, lens: 0.28, beamGain: 0.8 },
  back: { z: -23, y: 8.6, span: 14, lens: 0.24, beamGain: 0.7 },
};
const BEAM_LENGTH = 44;
const BEAM_RADIUS = 1.1;

// The beam is a soft cone: its alpha falls along its length and to zero at its silhouette (the edge seen
// side-on), so there is no hard edge, as in the mock-up. `uColor` is the colour now and `uFrom` the one
// being left at an interval change (both pure tokens; `uK` is how far the cross has got, S5).
const vertex = `varying float vT; varying float vFacing;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vT = -position.z / ${BEAM_LENGTH.toFixed(1)};
  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-view.xyz)));
  gl_Position = projectionMatrix * view;
}`;
const fragment = `uniform vec3 uColor;
uniform vec3 uFrom;
uniform float uK;
uniform float uOpacity;
varying float vT;
varying float vFacing;
void main() {
  float a = uOpacity * (1.0 - vT) * (1.0 - vT) * smoothstep(0.0, ${BEAM_SOFT_EDGE.toFixed(2)}, vFacing);
  gl_FragColor = vec4(mix(uFrom, uColor, uK), a);
  #include <colorspace_fragment>
}`;

export class FixtureView {
  /** Turned by the rig: the beam and the lens hang off it. */
  readonly pivot = new Group();
  readonly beamMaterial: ShaderMaterial;
  readonly lensMaterial: MeshBasicMaterial;
  readonly gain: number;

  readonly model: ModelFixture;

  constructor(model: ModelFixture) {
    this.model = model;
    const spec = lookup(LAYERS, model.layer);
    const t = model.count > 1 ? model.index / (model.count - 1) : 0.5;
    this.gain = spec.beamGain;
    this.pivot.position.set((2 * t - 1) * spec.span, spec.y, spec.z);
    const geometry = new ConeGeometry(BEAM_RADIUS, BEAM_LENGTH, 20, 1, true);
    geometry.translate(0, -BEAM_LENGTH / 2, 0); // apex at the lens, the cone below it
    geometry.rotateX(Math.PI / 2); // and then along -z, the beam's own axis
    this.beamMaterial = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(1, 1, 1) }, uFrom: { value: new Color(1, 1, 1) }, uK: { value: 1 }, uOpacity: { value: 0 } },
      vertexShader: vertex, fragmentShader: fragment,
      transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide,
    });
    this.lensMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0, toneMapped: false });
    const lens = new Mesh(new CircleGeometry(spec.lens, 20), this.lensMaterial);
    this.pivot.add(new Mesh(geometry, this.beamMaterial), lens);
  }

  /**
   * The beam in sRGB hex: `to` now, `from` being left, `k` how far over (both are tokens, never a mixed colour). The lens is one
   * colour (`lensHex`, white in a flash). Brightness 0 to 1 for the beam and the lens.
   */
  light(to: number, from: number, k: number, beam: number, lensHex: number, lens: number): void {
    (this.beamMaterial.uniforms.uColor!.value as Color).setHex(to);
    (this.beamMaterial.uniforms.uFrom!.value as Color).setHex(from);
    this.beamMaterial.uniforms.uK!.value = Math.min(1, Math.max(0, k));
    this.beamMaterial.uniforms.uOpacity!.value = Math.max(0, Math.min(0.9, beam * this.gain));
    this.lensMaterial.color.setHex(lensHex);
    this.lensMaterial.opacity = Math.max(0, Math.min(1, lens));
  }
}

export const buildFixtures = (): FixtureView[] => FIXTURES.map((f) => new FixtureView(f));
