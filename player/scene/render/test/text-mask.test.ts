// The dark-under-text mask (scene.md S2): its geometry and numbers, and that it is drawn last and
// can only darken. The measured light under real text is the browser run's (tools/text-shots.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CustomBlending, MinEquation } from "three";
import { SceneRig } from "../src/rig.ts";
import { CUSTOM_BLENDING, MIN_EQUATION, TextMask } from "../src/text-mask.ts";
import { CAP_MARGIN, FADE, GROW, MAX_BOXES, SPEC_GROW, decodeSrgb, encodeSrgb, grownBox, maskBoxes, maskLevel, maskQuad, maskWeight } from "../src/text-mask-calc.ts";
import { RENDER_DIR, tokensFromFile } from "../tools/tokens-file.ts";

const H = 1000;
const box = { left: 300, top: 400, right: 700, bottom: 450 }; // pixels on a 1000 px high window
const m = maskBoxes([box], H);

test("the cap: the level the mask holds every channel to decodes to at most 0.075, under the 0.08 cap, in every channel and so in luminance", () => {
  const level = maskLevel(0.08);
  assert.ok(decodeSrgb(level) <= 0.08 * CAP_MARGIN + 1e-9 && decodeSrgb(level) <= 0.08);
  assert.ok(Math.abs(decodeSrgb(encodeSrgb(0.5)) - 0.5) < 1e-9);
  // Luminance is a weighted sum of the channels with weights adding to 1, so equal channels at the level give exactly that luminance.
  assert.ok(0.2126 * decodeSrgb(level) + 0.7152 * decodeSrgb(level) + 0.0722 * decodeSrgb(level) <= 0.08);
  assert.ok(maskLevel(0.08) < maskLevel(0.2), "the cap token moves the level");
});

test("the mask is full inside the box grown by 1.2 vh, fades over 3 vh, and is nothing beyond (x, y in window heights, y up)", () => {
  const [l, b, r, t] = [m.at(0)!.l, m.at(0)!.b, m.at(0)!.r, m.at(0)!.t];
  assert.deepEqual([l, r], [0.3, 0.7]);
  assert.ok(Math.abs(t - 0.6) < 1e-9 && Math.abs(b - 0.55) < 1e-9, "pixels down become window heights up");
  assert.equal(maskWeight((l + r) / 2, (b + t) / 2, m), 1);
  assert.equal(maskWeight(l - SPEC_GROW, (b + t) / 2, m), 1, "1.2 vh from the box: still full");
  assert.equal(maskWeight(l - GROW, (b + t) / 2, m), 1, "the mask grows 0.3 vh more than the spec asks, for the scene's render scale");
  assert.ok(GROW >= SPEC_GROW && GROW - SPEC_GROW <= 0.005);
  const mid = maskWeight(l - GROW - FADE / 2, (b + t) / 2, m);
  assert.ok(mid > 0.3 && mid < 0.7, `half way through the fade: ${mid}`);
  assert.equal(maskWeight(l - GROW - FADE, (b + t) / 2, m), 0, "past the fade: the scene as it is");
  assert.equal(maskWeight(0.5, t + GROW + FADE + 0.001, m), 0);
  assert.equal(maskWeight(0.5, 0.5, []), 0, "no text, no mask");
  const ramp = [0, 0.25, 0.5, 0.75, 1].map((f) => maskWeight(l - GROW - f * FADE, (b + t) / 2, m));
  assert.deepEqual([...ramp].sort((a, c) => c - a), ramp, "monotone");
});

test("the measured area under a box is the spec's 1.2 vh, inside what the mask holds", () => {
  const g = grownBox(box, H);
  assert.deepEqual([g.left, g.top, g.right, g.bottom], [300 - 12, 400 - 12, 700 + 12, 450 + 12]);
  for (const [x, y] of [[g.left, g.top], [g.right, g.bottom], [g.left, g.bottom], [g.right, g.top]] as const) assert.equal(maskWeight(x / H, 1 - y / H, m), 1, `corner ${x},${y}`);
});

test("each box is a quad that covers it, its growth and its fade, in clip space", () => {
  const q = maskQuad(m.at(0)!, 16 / 9);
  const reach = GROW + FADE;
  assert.ok(Math.abs((q.cx - q.hx + 1) / 2 * (16 / 9) - (0.3 - reach)) < 1e-9, "left edge");
  assert.ok(Math.abs((q.cx + q.hx + 1) / 2 * (16 / 9) - (0.7 + reach)) < 1e-9, "right edge");
  assert.ok(Math.abs((q.cy + q.hy + 1) / 2 - (0.6 + reach)) < 1e-9, "top edge");
  assert.equal(maskBoxes(Array.from({ length: MAX_BOXES + 5 }, () => box), H).length, MAX_BOXES, "at most the quads there are");
});

test("blending: the mask writes the lower of the scene and its level; the numbers are three.js's own", () => {
  assert.equal(CUSTOM_BLENDING, CustomBlending);
  assert.equal(MIN_EQUATION, MinEquation);
  const mask = new TextMask(0.08);
  mask.set([box, box], 1778, H);
  const meshes = mask.group.children as unknown as { visible: boolean; renderOrder: number; material: { blending: number; blendEquation: number; depthTest: boolean; uniforms: Record<string, { value: unknown }> } }[];
  assert.equal(meshes.length, MAX_BOXES);
  assert.deepEqual(meshes.map((x) => x.visible).filter(Boolean).length, 2, "a quad per text line");
  for (const mesh of meshes) assert.deepEqual([mesh.material.blending, mesh.material.blendEquation, mesh.material.depthTest], [CustomBlending, MinEquation, false]);
  assert.equal(meshes.at(0)!.material.uniforms.uLevel!.value, maskLevel(0.08));
  mask.setEnabled(false);
  assert.equal(meshes.at(0)!.material.uniforms.uOn!.value, 0);
});

test("the mask is the last thing the rig draws, over the burst, and the shader repeats the calculation's numbers", () => {
  const rig = new SceneRig(tokensFromFile());
  const orders: number[] = [];
  rig.scene.traverse((o) => { orders.push(o.renderOrder); });
  assert.equal(Math.max(...orders), 1000);
  assert.ok(rig.scene.children.at(-1) === rig.mask.group, "added after the burst plane");
  const shader = readFileSync(join(RENDER_DIR, "src", "text-mask.ts"), "utf8");
  assert.match(shader, /GROW\.toFixed\(4\)[\s\S]*GROW \+ FADE/, "the fragment shader takes its growth and fade from the calculation");
  assert.equal(rig.mask.group.children.length, MAX_BOXES);
});
