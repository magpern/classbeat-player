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
import { aimQuaternion, aimedDirection, worldVector } from "../src/aim.ts";
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
const allowed = [...Object.values(tokens.zones), tokens.white];
const hueHex = (h: { kind: "zone"; zone: 1 | 2 | 3 | 4 | 5 | 6 | 7 } | { kind: "white" }) => (h.kind === "zone" ? tokens.zones[h.zone] : tokens.white);
const tokenA = (rig: SceneRig) => hexOf(rig.uniform("uTokA") as Color);
const tokenB = (rig: SceneRig) => hexOf(rig.uniform("uTokB") as Color);
const flags = (rig: SceneRig) => rig.uniform("uBF") as number[];

test("rule 7: the shader is given the planned zone's token, the next zone's only during the anticipation, and a flag per light that is 0 or 1; on every frame of the class", () => {
  const rig = new SceneRig(tokens);
  const loop = new RigLoop(tokens);
  const seenZones = new Set<number>();
  let frames = 0;
  for (let ms = 0, n = 0; ms < 160_000; n++) {
    const d: Draw = loop.step(feedAt(ms), n === 0 ? 0 : 1 / 30, "High");
    rig.apply(d, "High");
    assert.equal(tokenA(rig), hueHex(d.tokens.current), `current at ${ms}`);
    assert.equal(tokenB(rig), hueHex(d.tokens.next ?? d.tokens.current), `next at ${ms}`);
    assert.ok(allowed.includes(tokenA(rig)) && allowed.includes(tokenB(rig)));
    assert.ok(flags(rig).every((f) => f === 0 || f === 1), "a source carries one token or the other, never a share");
    if (d.tokens.next === null) assert.ok(flags(rig).every((f) => f === 0), `no next token, no light on it at ${ms}`);
    seenZones.add(tokenA(rig));
    ms += d.dtSeconds * 1000;
    frames++;
  }
  assert.ok(frames > 4000 && seenZones.size >= 6, `zones seen ${seenZones.size}`);
});

test("the anticipation: the back truss takes the next zone's token from the far side, the front stays (S5)", () => {
  const rig = new SceneRig(tokens);
  const loop = new RigLoop(tokens);
  const d = loop.step(feedAt(35_000), 0, "High"); // zone 2 -> 4 at 40 s: 5 s into the 10 s anticipation
  rig.apply(d, "High");
  const flag = (layer: string, index: number) => flags(rig)[rig.fixtures.findIndex((f) => f.model.layer === layer && f.model.index === index)];
  assert.equal(tokenA(rig), tokens.zones[2]);
  assert.equal(tokenB(rig), tokens.zones[4]);
  assert.equal(flag("front", 0), 0);
  assert.equal(flag("front", 7), 0);
  assert.equal(flag("back", 0), 0); // the far side turns first
  assert.equal(flag("back", 7), 1);
});

test("the hue cross runs only in the 700 ms that end at the change, from the right edge to the left, and its front only moves left", () => {
  const rig = new SceneRig(tokens);
  const loop = new RigLoop(tokens);
  let [crossing, last] = [0, 2];
  for (let ms = 36_000, n = 0; ms < 41_000; n++) {
    const d = loop.step(feedAt(ms), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    const front = rig.uniform("uCrossX") as number;
    if (front < 2) {
      crossing++;
      assert.ok(ms >= 39_290 && ms < 40_000, `a cross at ${ms}`);
      assert.ok(front <= last + 1e-9 && front >= 0 && front <= 1, "it moves toward the gel");
      last = front;
    } else assert.equal(front, 2);
    ms += d.dtSeconds * 1000;
  }
  assert.ok(crossing >= 38 && crossing <= 44, `about 700 ms of frames: ${crossing}`);
});

test("reduced motion (S11): the still rig shows no change between two frames a second apart", () => {
  const rig = new SceneRig(tokens);
  const loop = new RigLoop(tokens);
  const snap = () => JSON.stringify([rig.measuredDirections(), rig.uniform("uBI"), rig.uniform("uBL"), flags(rig), tokenA(rig), rig.uniform("uAmb"), rig.uniform("uCrossX")]);
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

test("the shader draws the beams along the directions the rig holds, from the lenses' fixed places", () => {
  const rig = new SceneRig(tokens);
  const loop = new RigLoop(tokens);
  for (let ms = 30_000, n = 0; ms < 45_000; n++) {
    const d = loop.step(feedAt(ms), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    const [dirs, origins] = [rig.uniform("uBD") as { x: number; y: number; z: number }[], rig.uniform("uBO") as { x: number; y: number; z: number }[]];
    rig.measuredDirections().forEach((m, i) => {
      const [v, w] = [dirs.at(i)!, worldVector(m)];
      assert.ok(Math.abs(v.x - w.x) + Math.abs(v.y - w.y) + Math.abs(v.z - w.z) < 1e-9, `beam ${i}`);
      assert.ok(origins.at(i)!.z < -15 && origins.at(i)!.z > -24, "the three trusses' depths");
    });
    ms += d.dtSeconds * 1000;
  }
});
