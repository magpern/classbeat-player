// A report, not a gate (#546; the gate is the flash-budget issue's): the strict S6 count of scene.md on the real
// page. Every moment of the demo class is played at 60 fps in headless Chrome, locked with the beat and coasting,
// the scene's canvas is read every frame (linear light), and tools/luminance-steps.ts counts every change over
// 10 % of the larger end, each direction, no gate on duration, in every region: the whole screen, the four
// quadrants, every 1/3 x 1/3 window at a stride of 1/6 (the 3 x 3 grid, the grid offset by half a cell, and the
// positions between) and the 1/3 strips. The most changes in any sliding second, and the region it is in, go to the
// log and to artifacts/flash-steps.json, so a change can be compared with `main`. `main` does not meet the strict
// gate today (the review of #569 measured it), so this run fails only if it measured nothing.
//
// The same frames carry S5 (tools/s5-fit.ts): every pixel of every frame, read from the canvas as shown, must be
// `a x token + w x white` within 1 code value for the current zone's token, or the next zone's during the
// anticipation. 0 failing pixels is the gate.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { violations } from "./guard-trap.ts";
import { FIT_SOURCE, TOLERANCE } from "./s5-fit.ts";
import { MAX_CHANGES_PER_SECOND, findChanges, mostInASecond } from "./luminance-steps.ts";
import type { Change } from "./luminance-steps.ts";
import type { Open } from "./text-shots.ts";

interface Moment { readonly name: string; readonly fromS: number; readonly toS: number }
// The demo class (demo/scenario.ts): intervals at 20, 40, 60, 80, 100, 120 and 140 s; song changes at 60 s (into a
// song with no moments, so with a burst) and 100 s (into a song with a breakdown); a drop at 40 s; a pattern from 120 s.
export const MOMENTS: readonly Moment[] = [
  { name: "beats in zone 2", fromS: 24, toS: 27 },
  { name: "interval change (20 s)", fromS: 18.5, toS: 22.5 },
  { name: "build, drop, burst and fan, on an interval change (40 s)", fromS: 36, toS: 44 },
  { name: "song change that is also an interval change into a song with no moments (60 s)", fromS: 58.5, toS: 63.5 },
  { name: "light-only burst on an interval change in a song with no moments (80 s)", fromS: 78.5, toS: 83 },
  { name: "song change and interval change into a song with moments (100 s)", fromS: 98.5, toS: 103.5 },
  { name: "zone 7 beats", fromS: 103.5, toS: 106.5 },
  { name: "breakdown and the interval change at 120 s", fromS: 118.5, toS: 131 },
  { name: "interval change (140 s)", fromS: 138.5, toS: 142.5 },
  { name: "the class ends (160 s)", fromS: 158.5, toS: 161.5 },
];
/** The states measured on the moments: the real running state, and without the beat. */
const STATES = [["locked", ""], ["coasting", "&state=coasting"]] as const;

type Rect = readonly [name: string, x0: number, y0: number, x1: number, y1: number];
/** Every region the count looks at, as shares of the width and the height. */
export const REGIONS: readonly Rect[] = (() => {
  const r: Rect[] = [["whole", 0, 0, 1, 1]];
  for (const [i, [x, y]] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]].entries()) r.push([`quadrant ${i}`, x!, y!, x! + 0.5, y! + 0.5]);
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) r.push([`window ${i}${j}`, i / 6, j / 6, i / 6 + 1 / 3, j / 6 + 1 / 3]);
  for (let i = 0; i <= 4; i++) { r.push([`row ${i}`, 0, i / 6, 1, i / 6 + 1 / 3]); r.push([`column ${i}`, i / 6, 0, i / 6 + 1 / 3, 1]); }
  return r;
})();
/** The page plays this long, undrawn, before a window: a jump from the page's first frame is read as a burst, and the next burst keeps 10 s from it. */
const WARM_UP_S = 12;

/** Reads the canvas after every frame: the relative luminance (linear light) of each region, by a summed-area table. */
const setup = `(() => {
  const [w, h] = [96, 54];
  const rects = ${JSON.stringify(REGIONS)};
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const lut = Array.from({ length: 256 }, (_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const sat = new Float64Array((w + 1) * (h + 1));
  const S5 = ${FIT_SOURCE};
  const full = document.createElement("canvas");
  const shown = document.getElementById("scene");
  full.width = shown.width; full.height = shown.height;
  const fctx = full.getContext("2d", { willReadFrequently: true });
  window.__steps = {
    t: [], regions: [], burst: [], cacheKey: "", cache: new Map(), s5: { frames: 0, pixels: 0, bad: 0, worst: "" },
    check(ms) {
      fctx.drawImage(shown, 0, 0);
      const px = fctx.getImageData(0, 0, full.width, full.height).data;
      const t = window.__scene.tokens;
      const allowed = [S5.linear(t.current)].concat(t.next === null ? [] : [S5.linear(t.next)]);
      const key = t.current + "/" + t.next;
      if (this.cacheKey !== key) { this.cacheKey = key; this.cache = new Map(); }
      let bad = 0;
      for (let i = 0; i < px.length; i += 4) {
        const code = px[i] << 16 | px[i + 1] << 8 | px[i + 2];
        let good = this.cache.get(code);
        if (good === undefined) { good = S5.fits(px[i], px[i + 1], px[i + 2], allowed, ${TOLERANCE}); this.cache.set(code, good); }
        if (good) continue; bad++; if (this.s5.worst === "") this.s5.worst = "rgb " + px[i] + " " + px[i + 1] + " " + px[i + 2] + " at " + (ms / 1000).toFixed(2) + " s";
      }
      this.s5.frames++; this.s5.pixels += px.length / 4; this.s5.bad += bad;
    },
    run(from, to) {
      const self = this;
      window.__scene.advance(Math.max(0, from - ${WARM_UP_S}) * 1000, from * 1000, 60, { draws: () => false, after() {} });
      window.__scene.advance(from * 1000, to * 1000, 60, { draws: () => true, after(ms) {
        ctx.drawImage(document.getElementById("scene"), 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const lum = 0.2126 * lut[px[i]] + 0.7152 * lut[px[i + 1]] + 0.0722 * lut[px[i + 2]];
          sat[(y + 1) * (w + 1) + x + 1] = lum + sat[y * (w + 1) + x + 1] + sat[(y + 1) * (w + 1) + x] - sat[y * (w + 1) + x];
        }
        self.check(ms);
        self.t.push(ms);
        self.regions.push(rects.map(([, x0, y0, x1, y1]) => {
          const [a, b, c, d] = [Math.round(x0 * w), Math.round(y0 * h), Math.round(x1 * w), Math.round(y1 * h)];
          return (sat[d * (w + 1) + c] - sat[b * (w + 1) + c] - sat[d * (w + 1) + a] + sat[b * (w + 1) + a]) / ((c - a) * (d - b));
        }));
        self.burst.push(window.__scene.burst);
      } });
    },
  };
})()`;

interface Series { t: number[]; regions: number[][]; burst: number[]; s5: { frames: number; pixels: number; bad: number; worst: string } }
export interface Run {
  readonly frames: number;
  readonly burstFrames: number;
  /** The most changes in any sliding second, over every region, and the region it is in. */
  readonly most: number;
  readonly worstRegion: string;
  readonly worstChanges: Change[];
  /** S5: pixels checked and pixels that are not `a x token + w x white`, over every frame of the run. */
  readonly s5: { readonly frames: number; readonly pixels: number; readonly bad: number; readonly worst: string };
  readonly byRegion: Record<string, number>;
}
export interface Counted { readonly moment: string; readonly state: string; readonly run: Run }

async function play(open: Open, m: Moment, query: string): Promise<Run> {
  const { page, problems } = await open(480, 270, query);
  await page.evaluate(setup);
  await page.evaluate(`window.__steps.run(${m.fromS}, ${m.toS})`);
  const out = await page.evaluate(() => (window as unknown as { __steps: Series }).__steps);
  assert.deepEqual([...problems, ...(await violations(page))], [], m.name);
  await page.close();
  const changesOf = (r: number) => findChanges(out.t, out.regions.map((row) => row[r]!));
  const byRegion: Record<string, number> = {};
  REGIONS.forEach(([name], r) => { byRegion[name] = mostInASecond(changesOf(r)); });
  const [worstRegion, most] = Object.entries(byRegion).reduce((a, b) => (b[1] > a[1] ? b : a));
  const round = (c: Change): Change => ({ atMs: Math.round(c.atMs), rising: c.rising, from: Number(c.from.toFixed(4)), to: Number(c.to.toFixed(4)) });
  return { frames: out.t.length, burstFrames: out.burst.filter((b) => b > 0).length, most, worstRegion, s5: out.s5, worstChanges: changesOf(REGIONS.findIndex(([n]) => n === worstRegion)).map(round), byRegion };
}

/** Plays every moment in each state, reports the strict S6 count, and gates S5 on every frame. */
export async function reportS6(open: Open, artifacts: string): Promise<Counted[]> {
  const counted: Counted[] = [];
  const s5Faults: string[] = [];
  for (const m of MOMENTS) {
    const line: string[] = [];
    for (const [state, query] of STATES) {
      const run = await play(open, m, query);
      assert.ok(run.frames >= (m.toS - m.fromS) * 55, `${m.name}, ${state}: only ${run.frames} frames measured`);
      if (run.s5.bad > 0) s5Faults.push(`${m.name}, ${state}: ${run.s5.bad} of ${run.s5.pixels} pixels are not a x token + w x white, for example ${run.s5.worst}`);
      counted.push({ moment: m.name, state, run });
      line.push(`${state} ${run.most} (${run.worstRegion}), S5 ${run.s5.bad} of ${run.s5.pixels} px`);
    }
    console.log(`S6 report, ${m.name}: ${line.join(", ")} (limit ${MAX_CHANGES_PER_SECOND}; not gated here)`);
  }
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, "flash-steps.json"), JSON.stringify({ limitPerSecond: MAX_CHANGES_PER_SECOND, moments: counted }, null, 2));
  assert.deepEqual(s5Faults, [], "S5: a rendered pixel is not a x token + w x white");
  return counted;
}
