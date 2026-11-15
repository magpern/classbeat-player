// S6 on the real page (tools/shots.ts calls it): the luminance steps of the scene's canvas on every moment
// of the demo class, frame by frame at 60 fps in headless Chrome, counted per region (the whole screen,
// its four quadrants and a 3 x 3 grid: every region is over 10 % of the screen) with tools/luminance-steps.ts.
// Each moment is played twice:
//   - as it is (locked, with the beat), counted by the absolute measure (a change of more than 0.1 in relative
//     luminance, WCAG 2.3.1), which the beat's own lift never reaches, and
//   - at the None level (coasting: no beat, so no lift, but every burst, dim, flash and cross runs as it does
//     locked), counted by the strict relative measure (more than 10 % of the larger end), which sees every
//     orchestrated step even in a dim region and is the count of "steps" this criterion's moments are about.
// The beat lift has its own limit (3 a second, tokens-light.test.ts). Both runs fail above 3 steps in any
// second, in any region; a window that shows fewer steps than the moment certainly has fails too (a
// measurement that sees nothing proves nothing); and the moment it is named for must have happened (the
// combined case is a burst and no lens flash). The counts go to artifacts/flash-steps.json and the log.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { violations } from "./guard-trap.ts";
import { MAX_STEPS_PER_SECOND, findSteps, mostInASecond } from "./luminance-steps.ts";
import type { Measure } from "./luminance-steps.ts";
import type { Open } from "./text-shots.ts";

interface Moment {
  readonly name: string;
  readonly fromS: number;
  readonly toS: number;
  /** What the window must show, so the measurement is of the moment and not of a quiet room. */
  readonly expects: { readonly burst: boolean; readonly flash: boolean; readonly absolute: number; readonly relative: number };
}
// The demo class (demo/scenario.ts): intervals at 20, 40, 60, 80, 100, 120 and 140 s; song changes at 60 s (into a
// song with no moments, so with a burst) and 100 s (into a song with a breakdown); a drop at 40 s; a pattern from 120 s.
export const MOMENTS: readonly Moment[] = [
  { name: "beats in zone 2", fromS: 24, toS: 27, expects: { burst: false, flash: false, absolute: 0, relative: 0 } },
  { name: "interval change with a lens flash and a colour cross (20 s)", fromS: 18.5, toS: 22.5, expects: { burst: false, flash: true, absolute: 0, relative: 1 } },
  { name: "build, drop, burst and fan, on an interval change (40 s)", fromS: 36, toS: 44, expects: { burst: true, flash: false, absolute: 1, relative: 2 } },
  { name: "song change that is also an interval change into a song with no moments (60 s)", fromS: 58.5, toS: 63.5, expects: { burst: true, flash: false, absolute: 1, relative: 3 } },
  { name: "light-only burst on an interval change in a song with no moments (80 s)", fromS: 78.5, toS: 83, expects: { burst: true, flash: false, absolute: 1, relative: 1 } },
  { name: "song change and interval change into a song with moments (100 s)", fromS: 98.5, toS: 103.5, expects: { burst: false, flash: true, absolute: 0, relative: 2 } },
  { name: "zone 7 beats", fromS: 103.5, toS: 106.5, expects: { burst: false, flash: false, absolute: 0, relative: 0 } },
  { name: "breakdown, flash and the 8 up, 8 down pattern with its accents (120 s)", fromS: 118.5, toS: 131, expects: { burst: false, flash: true, absolute: 0, relative: 1 } },
  { name: "the class ends: the house lights come up (160 s)", fromS: 158.5, toS: 161.5, expects: { burst: false, flash: false, absolute: 0, relative: 1 } },
];

const REGIONS = ["whole", "top left", "top right", "bottom left", "bottom right", ...Array.from({ length: 9 }, (_, i) => `cell ${Math.floor(i / 3)}${i % 3}`)];
/** The page plays this long, undrawn, before a window: a jump from the page's first frame is read as a burst, and the next burst keeps 10 s from it. */
const WARM_UP_S = 12;

/** Reads the canvas after every frame: the relative luminance (linear light) of each region. */
const setup = `(() => {
  const [w, h] = [96, 54];
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const lut = Array.from({ length: 256 }, (_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  window.__steps = {
    t: [], regions: [], burst: [], flash: [],
    run(from, to) {
      const self = this;
      window.__scene.advance(Math.max(0, from - ${WARM_UP_S}) * 1000, from * 1000, 60, { draws: () => false, after() {} });
      window.__scene.advance(from * 1000, to * 1000, 60, { draws: () => true, after(ms) {
        ctx.drawImage(document.getElementById("scene"), 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        const sums = new Array(14).fill(0), counts = new Array(14).fill(0);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const lum = 0.2126 * lut[px[i]] + 0.7152 * lut[px[i + 1]] + 0.0722 * lut[px[i + 2]];
          const mine = [0, 1 + (x >= w / 2 ? 1 : 0) + (y >= h / 2 ? 2 : 0), 5 + Math.floor(y / (h / 3)) * 3 + Math.floor(x / (w / 3))];
          for (const r of mine) { sums[r] += lum; counts[r]++; }
        }
        self.t.push(ms);
        self.regions.push(sums.map((s, r) => s / counts[r]));
        self.burst.push(window.__scene.burst);
        self.flash.push(window.__scene.flash);
      } });
    },
  };
})()`;

interface Series { t: number[]; regions: number[][]; burst: number[]; flash: number[] }
interface Step { atMs: number; rising: boolean; from: number; to: number; returns: boolean }
interface Run {
  readonly frames: number;
  readonly burstFrames: number;
  readonly flashFrames: number;
  /** The most steps in a second, by the measure, in each region. */
  readonly counts: Record<Measure, Record<string, number>>;
  readonly worst: Record<Measure, { readonly region: string; readonly most: number; readonly steps: Step[] }>;
}
export interface Counted { readonly moment: string; readonly locked: Run; readonly none: Run }

async function play(open: Open, m: Moment, query: string): Promise<Run> {
  const { page, problems } = await open(640, 360, query);
  await page.evaluate(setup);
  await page.evaluate(`window.__steps.run(${m.fromS}, ${m.toS})`);
  const out = await page.evaluate(() => (window as unknown as { __steps: Series }).__steps);
  assert.deepEqual([...problems, ...(await violations(page))], [], m.name);
  await page.close();
  const stepsOf = (r: number, measure: Measure) => findSteps(out.t, out.regions.map((row) => row[r]!), measure);
  const tidy = (s: ReturnType<typeof stepsOf>): Step[] => s.map((x) => ({ atMs: Math.round(x.atMs), rising: x.rising, from: Number(x.from.toFixed(4)), to: Number(x.to.toFixed(4)), returns: x.returns }));
  const counts = { relative: {}, absolute: {} } as Run["counts"];
  const worst = {} as Run["worst"];
  for (const measure of ["relative", "absolute"] as const) {
    REGIONS.forEach((name, r) => { counts[measure][name] = mostInASecond(stepsOf(r, measure)); });
    const [region, most] = Object.entries(counts[measure]).reduce((a, b) => (b[1] > a[1] ? b : a));
    worst[measure] = { region, most, steps: tidy(stepsOf(REGIONS.indexOf(region), measure)) };
  }
  return { frames: out.t.length, burstFrames: out.burst.filter((b) => b > 0).length, flashFrames: out.flash.filter((f) => f > 0).length, counts, worst };
}

function check(m: Moment, what: string, run: Run, measure: Measure, atLeast: number): void {
  const w = run.worst[measure];
  const where = `${m.name}, ${what}, ${measure} measure`;
  assert.ok(run.frames >= (m.toS - m.fromS) * 55, `${where}: only ${run.frames} frames measured`);
  assert.ok(w.most <= MAX_STEPS_PER_SECOND, `${where}: ${w.most} luminance steps in a second in ${w.region}, over the limit of ${MAX_STEPS_PER_SECOND} (S6): ${JSON.stringify(w.steps)}`);
  assert.ok(w.most >= atLeast, `${where}: only ${w.most} steps seen where at least ${atLeast} are certain: the measurement sees nothing`);
  assert.equal(run.burstFrames > 0, m.expects.burst, `${where}: the burst`);
  assert.equal(run.flashFrames > 0, m.expects.flash, `${where}: the lens flash`);
  assert.ok(run.burstFrames === 0 || run.flashFrames === 0, `${where}: a burst and a lens flash in one window is two white events`);
}

export async function flashSteps(open: Open, artifacts: string): Promise<Counted[]> {
  const counted: Counted[] = [];
  for (const m of MOMENTS) {
    const [locked, none] = [await play(open, m, ""), await play(open, m, "&state=coasting")];
    counted.push({ moment: m.name, locked, none });
    console.log(`S6 ${m.name}: locked ${locked.worst.absolute.most} (absolute) and ${locked.worst.relative.most} (relative with the beat), no beat ${none.worst.relative.most} (relative, ${none.worst.relative.region}); burst ${locked.burstFrames} frames, lens flash ${locked.flashFrames} frames`);
    check(m, "locked", locked, "absolute", m.expects.absolute);
    check(m, "no beat", none, "relative", m.expects.relative);
  }
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, "flash-steps.json"), JSON.stringify({ limitPerSecond: MAX_STEPS_PER_SECOND, moments: counted }, null, 2));
  return counted;
}
