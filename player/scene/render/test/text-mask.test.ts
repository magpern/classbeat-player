// The dark-under-text mask (scene.md S2): its geometry and numbers, and that it is drawn last and
// can only darken. The measured light under real text is the browser run's (tools/text-shots.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { SceneRig } from "../src/rig.ts";
import { FRAGMENT } from "../src/scene-shader.ts";
import { TextMask } from "../src/text-mask.ts";
import { CAP_MARGIN, FADE, GROW, MAX_BOXES, SPEC_GROW, decodeSrgb, encodeSrgb, grownBox, maskBoxes, maskWeight } from "../src/text-mask-calc.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const H = 1000;
const box = { left: 300, top: 400, right: 700, bottom: 450 }; // pixels on a 1000 px high window
const m = maskBoxes([box], H);

test("the cap: the luminance the mask holds the light to is under the 0.08 cap with a margin, and the token moves it", () => {
  const level = new TextMask(0.08).level;
  assert.ok(level <= 0.08 * CAP_MARGIN + 1e-12 && level < 0.08);
  assert.ok(Math.abs(decodeSrgb(encodeSrgb(0.5)) - 0.5) < 1e-9);
  assert.ok(new TextMask(0.08).level < new TextMask(0.2).level, "the cap token moves the level");
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

test("the mask's boxes are the shader's uniforms: at most MAX_BOXES, in window heights, and off when disabled", () => {
  const mask = new TextMask(0.08);
  assert.equal(maskBoxes(Array.from({ length: MAX_BOXES + 5 }, () => box), H).length, MAX_BOXES, "at most the boxes the shader holds");
  mask.set([box, box], 1778, H);
  assert.equal(mask.count, 2);
  assert.deepEqual([mask.cornerA.at(0)!.x, mask.cornerA.at(0)!.y, mask.cornerB.at(0)!.x, mask.cornerB.at(0)!.y].map((v) => Number(v.toFixed(6))), [0.3, 0.55, 0.7, 0.6]);
  assert.ok(Math.abs(mask.level - 0.08 * CAP_MARGIN) < 1e-12 && mask.level < 0.08, "the cap, in linear light, with the margin");
  assert.equal(mask.on, 1);
  mask.setEnabled(false);
  assert.equal(mask.on, 0);
});

test("the cap is applied in linear light by a scale of the colour, so the token stays; the shader repeats the calculation's numbers", () => {
  const rig = new SceneRig(tokensFromFile());
  assert.equal(rig.uniform("uCap"), rig.mask.level);
  assert.equal((rig.uniform("uBoxA") as unknown[]).length, MAX_BOXES);
  const shader = FRAGMENT;
  assert.match(shader, new RegExp(`smoothstep\\(${GROW.toFixed(4)}, ${(GROW + FADE).toFixed(4)}, dd\\)`), "the growth and the fade come from the calculation");
  assert.match(shader, /col3 \*= mix\(1\.0, uCap \/ Y, w \* uMaskOn\)/, "a scale of the colour, never a per-channel clamp");
  assert.doesNotMatch(shader, /min\(col3|clamp\(col3/, "no per-channel clamp of the colour");
  assert.ok(shader.indexOf("uCap / Y") < shader.indexOf("gl_FragColor") && shader.lastIndexOf("encode(col3") > shader.indexOf("uCap / Y"), "the cap comes before the sRGB encoding, which is last");
});
