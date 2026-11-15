// The 700 ms colour cross at an interval change (scene.md "States", S5, rule 7): the front colour goes
// from the zone just left to the zone now in over `--m-change`, between exactly those two tokens and
// never a third hue; a seek, a frozen rig and reduced motion change at once.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RigHue } from "../../model/src/index.ts";
import { feedAt } from "../demo/scenario.ts";
import { ColourCross, DEFAULT_CROSS_MS, eased, sameHue } from "../src/colour-cross.ts";
import { RigLoop } from "../src/loop.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();
const zone = (z: 1 | 2 | 3 | 4 | 5 | 6 | 7): RigHue => ({ kind: "zone", zone: z });
const input = (interval: number, front: RigHue, dtMs = 16, instant = false) => ({ interval, front, dtMs, instant, crossMs: DEFAULT_CROSS_MS });

test("the cross takes --m-change (700 ms): from the zone left to the zone in, easing out, then it is the new colour alone", () => {
  const c = new ColourCross();
  c.update(input(0, zone(2)));
  let last = c.update(input(1, zone(4), 0)); // the frame of the change: nothing has crossed yet
  assert.deepEqual([last.from, last.to, last.k], [zone(2), zone(4), 0]);
  let ms = 0;
  let prev = 0;
  while (ms < 1000) {
    last = c.update(input(1, zone(4)));
    ms += 16;
    assert.ok(last.k >= prev, "it never goes back");
    prev = last.k;
    if (ms < DEFAULT_CROSS_MS - 16) assert.deepEqual([last.from, last.to], [zone(2), zone(4)], `still crossing at ${ms} ms`);
    if (ms === 352) assert.ok(last.k > 0.8 && last.k < 0.95, `out-cubic at half the time is ${last.k}`);
  }
  assert.deepEqual(last, { from: zone(4), to: zone(4), k: 1 });
  assert.ok(ms > DEFAULT_CROSS_MS);
  assert.equal(eased(0), 0);
  assert.equal(eased(1), 1);
});

test("S5: a cross is only ever between the zone left and the zone now in; no third hue, in any run of the class", () => {
  const c = new ColourCross();
  const seen = new Set<string>();
  const zones = [1, 2, 4, 5, 6, 7, 3, 2] as const;
  zones.forEach((z, i) => {
    for (let n = 0; n < 90; n++) {
      const x = c.update(input(i, zone(z), 16));
      for (const hue of [x.from, x.to]) seen.add(JSON.stringify(hue));
      if (x.k < 1) assert.ok(sameHue(x.from, zone(zones[i - 1] ?? z)) && sameHue(x.to, zone(z)), `interval ${i} frame ${n}`);
      else assert.ok(sameHue(x.from, x.to));
    }
  });
  assert.equal(seen.size, 7);
});

test("a seek (not the next interval), a frozen rig and reduced motion change at once; so does an interval of the same zone", () => {
  const instant = (go: (c: ColourCross) => ReturnType<ColourCross["update"]>) => { const c = new ColourCross(); c.update(input(0, zone(2))); return go(c); };
  assert.deepEqual(instant((c) => c.update(input(3, zone(5)))), { from: zone(5), to: zone(5), k: 1 }, "a jump of three intervals");
  assert.deepEqual(instant((c) => c.update(input(1, zone(5), 16, true))), { from: zone(5), to: zone(5), k: 1 }, "reduced motion or frozen");
  assert.deepEqual(instant((c) => c.update({ ...input(1, zone(5)), crossMs: 0 })), { from: zone(5), to: zone(5), k: 1 }, "--m-change of 0 ms");
  assert.deepEqual(instant((c) => c.update(input(1, zone(2)))), { from: zone(2), to: zone(2), k: 1 }, "the same zone");
});

test("a second change before the first is over starts from the colour that is nearer, and still crosses only two hues", () => {
  const c = new ColourCross();
  c.update(input(0, zone(1)));
  c.update(input(1, zone(3), 0));
  for (let n = 0; n < 5; n++) c.update(input(1, zone(3))); // barely under way
  const x = c.update(input(2, zone(6), 0));
  assert.deepEqual([x.from, x.to], [zone(1), zone(6)]);
});

test("the loop crosses at the class's interval change, and the still rig does not", () => {
  const at = (reducedMotion: boolean) => {
    const loop = new RigLoop(tokens);
    const ks: number[] = [];
    for (let ms = 18_000, n = 0; ms < 21_500; n++) {
      const d = loop.step(feedAt(ms, { reducedMotion }), n === 0 ? 0 : 1 / 60, "High");
      if (ms >= 19_950) ks.push(d.cross.k);
      ms += d.dtSeconds * 1000;
    }
    return ks;
  };
  const moving = at(false);
  assert.ok(moving.some((k) => k > 0 && k < 1) && moving.at(-1) === 1, "zone 1 to 2 at 20 s crosses");
  assert.ok(moving.filter((k) => k < 1).length >= 38 && moving.filter((k) => k < 1).length <= 44, `about 700 ms of 60 fps frames: ${moving.filter((k) => k < 1).length}`);
  assert.ok(at(true).every((k) => k === 1), "reduced motion: instant");
});
