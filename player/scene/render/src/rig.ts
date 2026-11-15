// The rig as a three.js scene graph, with no WebGL in it (so a test can build it in Node and read
// back what it holds): a fixed camera, 22 fixtures, the wall, two haze layers and the white burst
// plane. `apply` takes one `Draw` from the loop and sets every beam's direction to the model's drawn
// direction, and brightness and colour from the model's frame. Colours are the zone tokens and white
// only (S5, rule 7); nothing here computes an angle.

import { Color, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene } from "three";
import type { Direction, QualityLevel, RigHue } from "../../model/src/index.ts";
import { QUALITY } from "../../model/src/index.ts";
import { aimQuaternion, aimedDirection } from "./aim.ts";
import { FixtureView, buildFixtures } from "./fixtures.ts";
import { HazeLayer } from "./haze.ts";
import type { Draw } from "./loop.ts";
import type { SceneTokens } from "./tokens.ts";
import { TextMask } from "./text-mask.ts";
import { Wall } from "./wall.ts";
import { WALL_COLUMNS } from "./light-calc.ts";
import { lookup, nth } from "./lookup.ts";

const BEAM_BASE = 0.3;
const HAZE_GAIN = 1;
const WALL_GAIN = 0.4; // the wall is a back layer, well under the beams (a deep, dark room)

export class SceneRig {
  readonly scene = new Scene();
  /** Fixed: only its aspect ever changes (rule 5, the camera never moves). */
  readonly camera = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
  readonly fixtures: readonly FixtureView[] = buildFixtures();
  readonly wall = new Wall();
  readonly haze = [new HazeLayer(-12, 30), new HazeLayer(-20, 40)] as const;
  private readonly flash = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial({ color: new Color(1, 1, 1), transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));

  /** Drawn last: holds the light under the text to the cap (S2). */
  readonly mask: TextMask;
  private readonly tokens: SceneTokens;

  constructor(tokens: SceneTokens) {
    this.tokens = tokens;
    this.mask = new TextMask(tokens.textCap);
    this.scene.background = new Color(0x000000);
    for (const f of this.fixtures) this.scene.add(f.pivot);
    this.flash.position.z = -1;
    this.flash.renderOrder = 100;
    this.scene.add(this.wall.mesh, this.haze[0].mesh, this.haze[1].mesh, this.flash, this.mask.group);
    this.flash.material.color.setHex(tokens.white);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private hex(hue: RigHue): number {
    return hue.kind === "zone" ? lookup(this.tokens.zones, hue.zone) : this.tokens.white;
  }

  apply(draw: Draw, quality: QualityLevel): void {
    const { colours, energy, moments } = draw.frame;
    const q = lookup(QUALITY, quality);
    // The anticipation wipe comes from the far side (right); the still rig changes colour at once.
    const reached = (t: number) => (draw.reduced ? colours.wipe > 0 : t >= 1 - colours.wipe);
    const beam = BEAM_BASE * draw.master * (1 + 2 * draw.lift);
    this.fixtures.forEach((fx, i) => {
      aimQuaternion(nth(draw.drawn, i) ?? { pan: 0, tilt: 0 }, fx.pivot.quaternion);
      const lit = nth(draw.lit, i) === true;
      const t = fx.model.count > 1 ? fx.model.index / (fx.model.count - 1) : 0.5;
      const hue = fx.model.layer === "back" && reached(t) ? colours.back : colours.front;
      fx.light(this.hex(hue), lit ? beam : 0, (lit ? 0.9 * (1 + draw.lift) : 0.04) * draw.master);
    });
    const hazeLevel = energy.ambientGlow * HAZE_GAIN * (moments.gather ? 1.5 : 1) * draw.master;
    this.haze[0].set(this.hex(colours.front), hazeLevel, draw.seconds, true);
    this.haze[1].set(this.hex(colours.front), hazeLevel * 0.7, draw.seconds * 0.7, q.hazeLayers === 2);
    this.wall.mesh.visible = q.wall;
    if (q.wall) {
      this.wall.update((c) => this.hex(reached(c / (WALL_COLUMNS - 1)) ? colours.back : colours.front), energy.wall, draw.chaseStep, draw.seconds, draw.master * WALL_GAIN, draw.reduced);
    }
    this.flash.material.opacity = draw.burst * this.tokens.burstPeak;
    this.flash.visible = draw.burst > 0;
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
