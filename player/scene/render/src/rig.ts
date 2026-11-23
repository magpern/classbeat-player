// The rig as a three.js scene graph with no WebGL in it (so a test can build it in Node and read back what it
// holds): a fixed camera, 22 pivots that the model's drawn directions turn, and one fullscreen quad whose
// shader (scene-shader.ts) draws everything in linear light. `apply` takes one `Draw` from the loop and sets the
// shader's uniforms: each beam's origin, direction, brightness and token, the haze, the wall, the burst, the
// cross and the text cap. Colours are the zone tokens and white only (S5, rule 7); nothing here computes an angle.

import { assertNoRenderCallbacks } from "../guard/render-callbacks.ts"; // first: it captures three's defaults before any scene is built
import { Color, Mesh, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Vector3 } from "three";
import type { Direction, QualityLevel, RigHue } from "../../model/src/index.ts";
import { LENS_WHITE_AT_REST, QUALITY } from "../../model/src/index.ts";
import { BEAM_AXIS, aimQuaternion, aimedDirection } from "./aim.ts";
import { FixtureView, buildFixtures } from "./fixtures.ts";
import type { Draw } from "./loop.ts";
import { BEAMS, FRAGMENT, VERTEX } from "./scene-shader.ts";
import { beamFloor } from "./stage-calc.ts";
import type { SceneTokens } from "./tokens.ts";
import { TextMask } from "./text-mask.ts";
import { lookup, nth } from "./lookup.ts";

/** The fixed camera's half field of view, as the shader's `tan`: 25 degrees. */
export const TAN_H = Math.tan((25 * Math.PI) / 180);
const BEAM_GAIN = 0.2;
const LENS_UNLIT = 0.04;
const LENS_LIT = 0.9;
const WALL_LEVEL = 0.4; // the wall is a back layer, well under the beams (a deep, dark room)
const WALL_MODES = { "slow wave": 0, "wave and beat": 1, "beat chase": 1, "beat chase both ways": 2 } as const;

const array = (n: number, make: () => unknown) => Array.from({ length: n }, make);

export class SceneRig {
  readonly scene = new Scene();
  /** Fixed: only its aspect ever changes (rule 5, the camera never moves). */
  readonly camera = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
  readonly fixtures: readonly FixtureView[] = buildFixtures();
  /** Drawn last: holds the light under the text to the cap (S2). */
  readonly mask: TextMask;
  readonly material: ShaderMaterial;
  private readonly tokens: SceneTokens;
  /** False only in the test that shows the house look without S5b's floor (the check must fail on it). */
  floorOn = true;
  private aspect = 16 / 9;

  constructor(tokens: SceneTokens) {
    this.tokens = tokens;
    this.mask = new TextMask(tokens.textCap);
    this.material = new ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        uAspect: { value: 16 / 9 }, uTanH: { value: TAN_H }, uTime: { value: 0 },
        uTokA: { value: new Color() }, uTokB: { value: new Color() },
        uMaster: { value: 1 }, uAmb: { value: 0 }, uHazeDetail: { value: 3 }, uCrossX: { value: 2 }, uWipe: { value: 0 }, uStill: { value: 0 },
        uWallOn: { value: 1 }, uWallLevel: { value: 0 }, uWallMode: { value: 0 }, uChase: { value: 0 }, uBurst: { value: 0 }, uLensW: { value: LENS_WHITE_AT_REST },
        uN: { value: BEAMS },
        uBO: { value: array(BEAMS, () => new Vector3()) }, uBD: { value: array(BEAMS, () => new Vector3(0, 0, -1)) },
        uBP: { value: array(BEAMS * 4, () => 0) }, uFloor: { value: 0 },
        uBoxN: { value: 0 }, uBoxA: { value: this.mask.cornerA }, uBoxB: { value: this.mask.cornerB }, uCap: { value: this.mask.level }, uMaskOn: { value: 1 },
      },
    });
    const quad = new Mesh(new PlaneGeometry(1, 1), this.material);
    quad.frustumCulled = false;
    this.scene.background = new Color(0x000000);
    for (const f of this.fixtures) this.scene.add(f.pivot);
    this.scene.add(quad);
    this.material.uniforms.uBO!.value = this.fixtures.map((f) => f.pivot.position.clone());
    // The scene is complete: nothing is added later. Anything that is, or gets a new material, needs this check too.
    assertNoRenderCallbacks(this.scene);
  }

  /** A uniform's value (a test reads what the shader is given). */
  uniform(name: string): unknown {
    return lookup(this.material.uniforms, name).value as unknown;
  }

  /** The packed per-beam vec4 array (x beam, y lens, z token flag, w spread), flat: three.js uploads a flat array as it is. */
  private get beamPack(): number[] {
    return this.uniform("uBP") as number[];
  }

  private packed(component: 0 | 1 | 2): number[] {
    return Array.from({ length: BEAMS }, (_, i) => this.beamPack.at(i * 4 + component) ?? 0);
  }

  /** Each beam's luminance, its lens's, and which token it carries (0 the current, 1 the next), as the shader is given them. */
  beamLevels(): number[] { return this.packed(0); }
  lensLevels(): number[] { return this.packed(1); }
  tokenFlags(): number[] { return this.packed(2); }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uAspect!.value = aspect;
  }

  private linear(hue: RigHue, into: Color): void {
    into.setHex(hue.kind === "zone" ? lookup(this.tokens.zones, hue.zone) : this.tokens.white);
  }

  /** Which of the two tokens a fixture carries now: the back truss takes the next one as the anticipation's wipe reaches it, the others as the cross's front passes their lens. */
  private takesNext(fx: FixtureView, draw: Draw): boolean {
    const wipe = draw.frame.colours.wipe;
    if (fx.model.layer === "back" && wipe > 0 && (draw.reduced || fx.along >= 1 - wipe)) return true;
    const lens = fx.pivot.position;
    const share = Math.min(1, Math.max(0, (lens.x / (-lens.z * TAN_H * this.aspect)) * 0.5 + 0.5));
    return draw.cross.front < 2 && share >= draw.cross.front;
  }

  apply(draw: Draw, quality: QualityLevel): void {
    const u = this.material.uniforms;
    const { energy, colours } = draw.frame;
    const q = lookup(QUALITY, quality);
    this.linear(draw.tokens.current, u.uTokA!.value as Color);
    this.linear(draw.tokens.next ?? draw.tokens.current, u.uTokB!.value as Color);
    const ramp = draw.energyRamp; // the energy's ramp, where the scheduler placed it; the hue cross has its own front
    const lift = 1 + draw.lift; // every light of the rig by the same share (beams, lenses, haze, wall; never the text)
    const mix = (a: number, b: number) => a + (b - a) * ramp;
    const share = (g: number) => Math.min(1, Math.max(0, (g - 0.045) / 0.065));
    const e = draw.ahead ? mix(share(energy.ambientGlow), share(draw.ahead.energy.ambientGlow)) : share(energy.ambientGlow);
    // A fixture the cross brings on or puts out ramps with the energy: its lit share runs from the zone left to the zone entered.
    const beams = this.fixtures.map((fx, i) => {
      aimQuaternion(nth(draw.drawn, i) ?? { pan: 0, tilt: 0 }, fx.pivot.quaternion);
      const now = nth(draw.lit, i) === true ? 1 : 0;
      const lit = draw.ahead ? now + ((nth(draw.ahead.lit, i) === true ? 1 : 0) - now) * ramp : now;
      return {
        dir: BEAM_AXIS.clone().applyQuaternion(fx.pivot.quaternion),
        beam: BEAM_GAIN * fx.gain * (0.55 + 0.45 * e) * lift * draw.master * lit * draw.beamLevel,
        lens: (LENS_UNLIT + (LENS_LIT * lift - LENS_UNLIT) * lit) * draw.master,
        next: this.takesNext(fx, draw) ? 1 : 0,
      };
    });
    u.uBD!.value = beams.map((b) => b.dir);
    u.uBP!.value = beams.flatMap((b, i) => [b.beam, b.lens, b.next, nth(this.fixtures, i)?.spread ?? 0.03]);
    u.uFloor!.value = this.floorOn ? beamFloor(draw.stage) : 0;
    const glow = draw.ahead ? mix(energy.ambientGlow, draw.ahead.energy.ambientGlow) : energy.ambientGlow;
    u.uMaster!.value = draw.master;
    u.uAmb!.value = glow * draw.hazeGain * lift;
    u.uLensW!.value = LENS_WHITE_AT_REST + this.tokens.lensFlash * draw.lens;
    u.uHazeDetail!.value = q.hazeLayers === 2 ? 3 : 2;
    u.uCrossX!.value = draw.cross.front;
    u.uWipe!.value = colours.wipe;
    u.uStill!.value = draw.reduced ? 1 : 0;
    u.uTime!.value = draw.seconds;
    u.uWallOn!.value = q.wall && draw.stage !== "before" ? 1 : 0;
    u.uWallLevel!.value = WALL_LEVEL * lift;
    const mode = draw.ahead ? draw.ahead.energy.wall : energy.wall;
    u.uWallMode!.value = draw.chaseStep === null ? 0 : lookup(WALL_MODES, ramp > 0.5 ? mode : energy.wall);
    u.uChase!.value = draw.chaseStep ?? 0;
    u.uBurst!.value = draw.burst * this.tokens.burstPeak;
    u.uBoxN!.value = this.mask.count;
    u.uMaskOn!.value = this.mask.on;
  }

  /** What every beam really points at now, read back from the three.js objects. */
  measuredDirections(): Direction[] {
    return this.fixtures.map((f) => aimedDirection(f.pivot.quaternion));
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      (m.material as { dispose?: () => void } | undefined)?.dispose?.();
    });
  }
}
