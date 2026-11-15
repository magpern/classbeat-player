// The 22 moving heads: front truss 8, floor uplights 6, back truss 8 (scene.md "The scene"). Each is only a
// pivot at a fixed position that the rig turns by the model's drawn direction; the scene's one shader
// (scene-shader.ts) draws the beam and the lens from the pivot's position and the direction it points in.

import { Group } from "three";
import type { Fixture as ModelFixture, Layer } from "../../model/src/index.ts";
import { FIXTURES } from "../../model/src/index.ts";
import { lookup } from "./lookup.ts";

interface LayerSpec { readonly z: number; readonly y: number; readonly span: number; readonly gain: number; readonly spread: number }
/** Depths from scene.md: front 16, floor 19, back 23 (camera at 0, looking down -z). The back truss is smaller and dimmer. */
export const LAYERS: Readonly<Record<Layer, LayerSpec>> = {
  front: { z: -16, y: 6.4, span: 11, gain: 1, spread: 0.06 },
  floor: { z: -19, y: -7.6, span: 8, gain: 0.8, spread: 0.05 },
  back: { z: -23, y: 8.6, span: 14, gain: 0.85, spread: 0.07 },
};

export class FixtureView {
  /** Turned by the rig: its position is the lens, its axis the beam. */
  readonly pivot = new Group();
  readonly model: ModelFixture;
  readonly gain: number;
  readonly spread: number;
  /** Its place along its truss, 0 at the left end and 1 at the right. */
  readonly along: number;

  constructor(model: ModelFixture) {
    this.model = model;
    const spec = lookup(LAYERS, model.layer);
    const t = model.count > 1 ? model.index / (model.count - 1) : 0.5;
    this.gain = spec.gain;
    this.spread = spec.spread;
    this.along = t;
    this.pivot.position.set((2 * t - 1) * spec.span, spec.y, spec.z);
  }
}

export const buildFixtures = (): FixtureView[] => FIXTURES.map((f) => new FixtureView(f));
