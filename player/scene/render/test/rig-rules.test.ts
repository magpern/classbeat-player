// The scene rules on the renderer (rule-sensitive, scene.md "The product rules"): rule 4 (no beam
// direction from an interval, on the drawn directions), rule 5 (the camera never moves), rule 7
// (colour is the planned zone, the next zone's colour during the anticipation, and white), the
// still rig of reduced motion (S11), and what the beams really point at.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color } from "three";
import type { SceneClass } from "../../model/src/index.ts";
import { angleBetween } from "../../model/src/index.ts";
import { DEMO_CLASS, feedAt } from "../demo/scenario.ts";
import { aimQuaternion, aimedDirection } from "../src/aim.ts";
import type { Draw, Feed } from "../src/loop.ts";
import { RigLoop } from "../src/loop.ts";
import { SceneRig } from "../src/rig.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
/** The same songs and the same zone at every moment, but every other interval field different. */
const OTHER: SceneClass = { ...DEMO_CLASS, intervals: DEMO_CLASS.intervals.map((iv, i) => ({ startMs: iv.startMs, zone: iv.zone, targets: { cadence: [60 + i, 70 + i] }, position: i % 2 ? "standing" : "seated", cue: `cue ${i}`, pattern: { sides: ["up", "down"] } })) };

test("the direction a beam is aimed at is what the rig really holds, to a billionth of a degree", () => {
  for (const pan of [-104, -55, -12.5, 0, 30, 77.7, 150]) for (const tilt of [-60, -15, 0, 10, 35, 50]) {
    const d = { pan, tilt };
    const back = aimedDirection(aimQuaternion(d, new SceneRig(tokens).fixtures[3]!.pivot.quaternion));
    assert.ok(angleBetween(d, back) < 1e-9, `${pan}/${tilt} came back as ${back.pan}/${back.tilt}`);
  }
});

test("rule 4: same zones, every other interval field different: the rig holds identical beam directions on every frame", () => {
  const [a, b] = [new RigLoop(tokens), new RigLoop(tokens)];
  const [ra, rb] = [new SceneRig(tokens), new SceneRig(tokens)];
  let compared = 0;
  for (let ms = 10_000, n = 0; ms < 130_000; n++) {
    const raw = n === 0 ? 0 : n % 211 === 0 ? 0.25 : 1 / 60;
    const f: Feed = feedAt(ms);
    const da = a.step(f, raw, "High");
    const db = b.step({ ...f, cls: OTHER }, raw, "High");
    ra.apply(da, "High");
    rb.apply(db, "High");
    assert.deepEqual(ra.measuredDirections(), rb.measuredDirections(), `frame ${n}`);
    ms += da.dtSeconds * 1000;
    compared++;
  }
  assert.ok(compared > 6000);
});

test("rule 5: the camera is fixed; only its aspect may change", () => {
  const rig = new SceneRig(tokens);
  const [pos, quat] = [rig.camera.position.clone(), rig.camera.quaternion.clone()];
  const loop = new RigLoop(tokens);
  for (let ms = 0, n = 0; ms < 70_000; n++) {
    const d = loop.step(feedAt(ms), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    if (n % 500 === 0) rig.setAspect(1.2 + (n % 7) / 5);
    ms += d.dtSeconds * 1000;
  }
  assert.ok(rig.camera.position.equals(pos) && rig.camera.quaternion.equals(quat));
});

const hexOf = (c: Color) => c.getHex();
const CHANNEL = 1e-3;
const allowed = [...Object.values(tokens.zones), tokens.white];
const direction = (c: Color) => { const m = Math.max(c.r, c.g, c.b) || 1; return [c.r / m, c.g / m, c.b / m] as const; };
const isAllowedHue = (c: Color) => c.r + c.g + c.b === 0 || allowed.some((h) => { const a = direction(new Color(h)); const b = direction(c); return a.every((v, i) => Math.abs(v - b[i]!) < CHANNEL); });

test("rule 7: every colour in the rig, on every frame, is a zone token or white", () => {
  const rig = new SceneRig(tokens);
  const loop = new RigLoop(tokens);
  const seenZones = new Set<number>();
  let frames = 0;
  for (let ms = 0, n = 0; ms < 160_000; n++) {
    const d: Draw = loop.step(feedAt(ms), n === 0 ? 0 : 1 / 30, "High");
    rig.apply(d, "High");
    if (n % 20 === 0) {
      for (const f of rig.fixtures) {
        const u = f.beamMaterial.uniforms.uColor!.value as Color;
        assert.ok(allowed.includes(hexOf(u)), `beam ${hexOf(u).toString(16)}`);
        assert.ok(isAllowedHue(f.lensMaterial.color));
        seenZones.add(hexOf(u));
      }
      const wall = rig.wall.mesh.instanceColor!.array;
      for (let i = 0; i < wall.length; i += 3 * 37) assert.ok(isAllowedHue(new Color().setRGB(wall[i]!, wall[i + 1]!, wall[i + 2]!)), "wall dot");
    }
    ms += d.dtSeconds * 1000;
    frames++;
  }
  assert.ok(frames > 4000 && seenZones.size >= 6, `zones seen ${seenZones.size}`);
});

test("the anticipation: the back truss turns to the next zone's colour from the far side, the front stays (S5)", () => {
  const rig = new SceneRig(tokens);
  const loop = new RigLoop(tokens);
  const d = loop.step(feedAt(35_000), 0, "High"); // zone 2 -> 4 at 40 s: 5 s into the 10 s anticipation
  rig.apply(d, "High");
  const colour = (layer: string, index: number) => hexOf(rig.fixtures.find((f) => f.model.layer === layer && f.model.index === index)!.beamMaterial.uniforms.uColor!.value as Color);
  assert.equal(colour("front", 0), tokens.zones[2]);
  assert.equal(colour("front", 7), tokens.zones[2]);
  assert.equal(colour("back", 0), tokens.zones[2]); // the far side turns first
  assert.equal(colour("back", 7), tokens.zones[4]);
});

test("S5 at High quality: through the anticipation the haze shows no hue but the zone it is in; only the back truss and the wall wipe", () => {
  const rig = new SceneRig(tokens);
  const loop = new RigLoop(tokens);
  let inAnticipation = 0;
  for (let ms = 28_000, n = 0; ms < 41_000; n++) {
    const d = loop.step(feedAt(ms), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    const haze = rig.haze;
    for (const layer of haze) assert.equal(hexOf(layer.material.uniforms.uColor!.value as Color), tokens.zones[d.frame.colours.front.kind === "zone" ? d.frame.colours.front.zone : 1], `haze at ${ms}`);
    if (d.frame.colours.wipe > 0) inAnticipation++;
    ms += d.dtSeconds * 1000;
  }
  assert.ok(inAnticipation > 300);
});

test("reduced motion (S11): the still rig shows no change between two frames a second apart", () => {
  const rig = new SceneRig(tokens);
  const loop = new RigLoop(tokens);
  const snap = () => JSON.stringify([rig.measuredDirections(), rig.fixtures.map((f) => [f.beamMaterial.uniforms.uOpacity!.value, f.lensMaterial.opacity, hexOf(f.beamMaterial.uniforms.uColor!.value as Color)])]);
  let first = "";
  for (let ms = 22_000, n = 0; ms < 24_100; n++) {
    const d = loop.step(feedAt(ms, { reducedMotion: true }), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    if (n === 60) first = snap();
    if (n === 120) assert.equal(snap(), first);
    ms += d.dtSeconds * 1000;
  }
  assert.ok(first.length > 100);
});

test("the beams' length runs along the direction they are turned to", () => {
  const rig = new SceneRig(tokens);
  const f = rig.fixtures[0]!;
  const tip = f.pivot.children[0]!;
  const geometry = (tip as unknown as { geometry: { boundingBox: unknown; computeBoundingBox(): void } }).geometry;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox as { min: { z: number }; max: { z: number; y: number } };
  assert.ok(box.max.z <= 1e-9 && box.min.z < -40, `the cone runs from the lens along -z: ${box.min.z}..${box.max.z}`);
  assert.ok(Math.abs(box.max.y) < 2);
});
