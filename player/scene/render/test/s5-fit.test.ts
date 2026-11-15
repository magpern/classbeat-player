// S5's pixel check (tools/s5-fit.ts): a pixel is `a x token + w x white` in linear light within 1 code value. It
// passes a token at any lightness and with any share of white, and it fails a mix of two tokens and a per-channel
// tone map, on the closest pair of tokens (zones 5 and 6). The browser run applies it to every frame.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TOLERANCE, makeFit } from "../tools/s5-fit.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const fit = makeFit();
const tokens = tokensFromFile();
const T = (zone: 1 | 2 | 3 | 4 | 5 | 6 | 7) => fit.linear(tokens.zones[zone]);
/** The 8-bit sRGB pixel for linear colour `c`. */
const pixel = (c: readonly number[]) => c.map((v) => fit.enc(v)) as [number, number, number];
const ok = (px: readonly number[], allowed: readonly (readonly number[])[]) => fit.fits(px[0]!, px[1]!, px[2]!, allowed, TOLERANCE);

test("a token passes at any lightness and with any share of white; black and white pass", () => {
  for (const zone of [1, 2, 3, 4, 5, 6, 7] as const) {
    for (const a of [0.001, 0.01, 0.05, 0.2, 0.6, 1]) for (const w of [0, 0.002, 0.03, 0.2]) {
      const c = T(zone).map((v) => v * a + w);
      if (c.some((v) => v > 1)) continue;
      assert.ok(ok(pixel(c), [T(zone)]), `zone ${zone} a ${a} w ${w}`);
    }
  }
  assert.ok(ok([0, 0, 0], [T(1)]) && ok([255, 255, 255], [T(1)]) && ok([40, 40, 40], [T(6)]));
});

test("only the allowed tokens pass: another zone's token fails, and the next zone's token passes once it is allowed", () => {
  const px = pixel(T(4).map((v) => v * 0.3));
  assert.ok(!ok(px, [T(2)]));
  assert.ok(ok(px, [T(2), T(4)]));
});

/** A colour of the given relative luminance in the direction of `c`. */
const atLuminance = (c: readonly number[], lum: number) => { const y = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; return c.map((v) => (v * lum) / y); };

test("a mix of two tokens fails: zones 5 and 6 and zones 1 and 2, every ratio at relative luminance 0.2 and 17 of 19 at 0.1 (the end ratios, 5 % and 95 %, are within 1 code of a token itself)", () => {
  for (const [a, b] of [[5, 6], [1, 2]] as const) for (const lum of [0.1, 0.2]) for (let i = lum === 0.1 ? 2 : 1; i <= (lum === 0.1 ? 18 : 19); i++) {
    const k = i / 20;
    // The straight blend of the two tokens' linear colours is what a blend draws; it is neither token, so neither allows it.
    const mixed = atLuminance(T(a).map((v, j) => v * (1 - k) + T(b)[j]! * k), lum);
    assert.ok(!ok(pixel(mixed), [T(a), T(b)]), `zones ${a} and ${b} mixed ${k} at ${lum}`);
  }
});

test("what the check cannot see is said, not hidden: a mix of complementary tokens lies near the white axis and can pass (zones 1 and 4)", () => {
  const passing = Array.from({ length: 19 }, (_, i) => (i + 1) / 20).filter((k) => ok(pixel(atLuminance(T(1).map((v, j) => v * (1 - k) + T(4)[j]! * k), 0.2)), [T(1), T(4)]));
  assert.ok(passing.length > 0, "the spec records this: the rules, not the check, keep the rig to two tokens");
});

test("a per-channel tone map fails: the token's hue drifts when each channel is curved on its own, on zones 5 and 6", () => {
  for (const zone of [5, 6, 4, 7] as const) {
    for (const exposure of [2, 4, 8]) {
      const curved = T(zone).map((v) => 1 - Math.exp(-exposure * v));
      assert.ok(!ok(pixel(curved), [T(zone)]), `zone ${zone} at exposure ${exposure}`);
    }
  }
  // The hue-preserving map, which scales the colour by a luminance, passes.
  const y = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  for (const zone of [5, 6] as const) for (const lum of [0.02, 0.1, 0.2]) assert.ok(ok(pixel(T(zone).map((v) => (v * lum) / y(T(zone)))), [T(zone)]));
});

test("the closest pair of tokens, zones 5 and 6, is told apart by the fit in any lit pixel", () => {
  for (const lum of [0.01, 0.05, 0.2]) {
    const five = pixel(T(5).map((v) => v * lum));
    assert.ok(ok(five, [T(5)]) && !ok(five, [T(6)]), `lum ${lum}`);
  }
});
