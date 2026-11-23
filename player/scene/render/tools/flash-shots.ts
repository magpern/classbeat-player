// The strict S6 gate (#577; reported since #546; the whole frame since #591): the count of scene.md on the real page. Every moment of the demo class is played at 60 fps in headless Chrome, locked with the beat and coasting,
// the whole frame as shown (the scene's canvas and the text layer over it) is read every frame (linear light), and tools/luminance-steps.ts counts every change over
// 10 % of the larger end, each direction, no gate on duration, in every region: the whole screen, the four
// quadrants, every 1/3 x 1/3 window at a stride of 1/6 (the 3 x 3 grid, the grid offset by half a cell, and the
// positions between) and the 1/3 strips. The most changes in any sliding second, and the region it is in, go to the
// log and to artifacts/flash-steps.json. The run fails if any run of any moment, locked with the beat or coasting, has more
// than 3 changes in a sliding second in any region, and if it measured nothing. A run that fails is fixed in the light or
// the schedule, never in the measure.
//
// The whole frame: the canvas is read in the page every frame, and the text layer, which changes only on a text step, is
// taken from the page when it steps: a screenshot of the text over black and over white (the canvas hidden) gives each text pixel's
// colour and its opacity, and the frame is the canvas under it, blended as the browser does, in the page, every frame. The
// run is played in the page up to each text step (`__scene.resume`), the layer is captured, and the run goes on.
//
// The same frames carry S5 (tools/s5-fit.ts): every pixel of every frame, read from the canvas as shown, must be
// `a x token + w x white` within 1 code value for the current zone's token, or the next zone's during the
// anticipation. 0 failing pixels is the gate.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { violations } from "./guard-trap.ts";
import { overlayOf } from "./text-overlay.ts";
import { settleTransitions } from "./settle.ts";
import { FIT_SOURCE, TOLERANCE } from "./s5-fit.ts";
import { MAX_CHANGES_PER_SECOND, findChanges, mostInASecond } from "./luminance-steps.ts";
import type { Change } from "./luminance-steps.ts";
import type { Open } from "./text-shots.ts";
import { decodePng } from "./png.ts";
import type { Page } from "playwright-core";

/** What the person does during a moment, each once: a link state ("paused", or "base" for the run's own), a quality step, a seek or jump (`jumpMs`). */
interface Event { readonly atMs: number; readonly link?: string; readonly quality?: string; readonly jumpMs?: number }
interface Moment {
  readonly name: string; readonly fromS: number; readonly toS: number;
  /** A variant of the demo class (`class=`), for collisions. */
  readonly cls?: string;
  readonly events?: readonly Event[];
  /** The states in which the budget (on) must place a white burst in this moment: a gate that the scene bursts, not only that it stays under the count. */
  readonly bursts?: readonly string[];
  /** Frames the run must have (a jump skips time). */
  readonly frames?: number;
}
// The demo class (demo/scenario.ts): intervals at 20, 40, 60, 80, 100, 120 and 140 s; song changes at 60 s (into a
// song with no moments, so with a burst) and 100 s (into a song with a breakdown); a drop at 40 s; a pattern from 120 s.
export const MOMENTS: readonly Moment[] = [
  { name: "steady beats in zone 1", fromS: 6, toS: 9.5 },
  { name: "beats in zone 2", fromS: 24, toS: 27 },
  { name: "steady beats in zone 4", fromS: 50.6, toS: 54 },
  { name: "steady beats in zone 5", fromS: 64, toS: 67.5 },
  { name: "steady beats in zone 6", fromS: 88, toS: 91.5 },
  { name: "interval change (20 s)", fromS: 18.5, toS: 22.5 },
  { name: "build, drop and fan on an interval change (40 s): locked the ramp has the room (no burst, the fan is the drop frame); coasting the drop bursts", fromS: 36, toS: 44, bursts: ["coasting"] },
  { name: "build, drop and fan away from a change (58 s): the drop bursts", fromS: 54, toS: 59, bursts: ["locked", "coasting"] },
  { name: "song change that is also an interval change into a song with no moments (60 s)", fromS: 58.5, toS: 63.5 },
  { name: "interval change in a song with no moments (80 s): locked the ramp has the room (no burst); coasting the light-only burst", fromS: 78.5, toS: 83, bursts: ["coasting"] },
  { name: "song change and interval change into a song with moments (100 s)", fromS: 98.5, toS: 103.5 },
  { name: "zone 7 beats", fromS: 103.5, toS: 106.5 },
  { name: "breakdown and the interval change at 120 s", fromS: 118.5, toS: 131 },
  { name: "interval change (140 s)", fromS: 138.5, toS: 142.5 },
  { name: "the class ends (160 s)", fromS: 158.5, toS: 161.5 },
  // What the person does, and what collides (scene.md "Every moment, worst case"): a user action, a quality step, merges.
  { name: "user actions: pause at 70 s, resume at 71.2 s", fromS: 68.5, toS: 73, events: [{ atMs: 70_000, link: "paused" }, { atMs: 71_200, link: "base" }] },
  { name: "user action: a 15 s jump at 71 s, from 71 s to 86 s", fromS: 69.5, toS: 88, events: [{ atMs: 71_000, jumpMs: 86_000 }], frames: 3.5 },
  { name: "user action: a seek back at 20.5 s to 19 s, across the change at 20 s again", fromS: 18.5, toS: 23, events: [{ atMs: 20_500, jumpMs: 19_000 }], frames: 6 },
  { name: "quality steps: High to Medium at 70 s, Medium to Low at 72 s", fromS: 68.5, toS: 74, events: [{ atMs: 70_000, quality: "Medium" }, { atMs: 72_000, quality: "Low" }] },
  { name: "song change away from an interval change (70 s: the song-change dim)", fromS: 68.5, toS: 72.5, cls: "dim" },
  { name: "collision: intervals 0.4 s apart (20.0 s and 20.4 s)", fromS: 18.5, toS: 23, cls: "collide" },
  { name: "collision: a drop 0.4 s after a change (40.0 s and 40.4 s)", fromS: 38.5, toS: 44, cls: "collide", bursts: ["coasting"] },
  { name: "collision: intervals 0.3 s apart in a song with no moments (80.0 s and 80.3 s)", fromS: 78.5, toS: 83, cls: "collide" },
  { name: "collision: song change and intervals 0.6 s apart (100.0 s and 100.6 s)", fromS: 98.5, toS: 103.5, cls: "collide" },
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

/** Reads the whole frame after every frame: the canvas under the text layer's captured pixels (`setOverlay`), the relative luminance (linear light) of each region, by a summed-area table. */
export const probeSetup = `(() => {
  const [w, h] = [96, 54];
  const [W, H] = [window.innerWidth, window.innerHeight];
  const rects = ${JSON.stringify(REGIONS)};
  const lut = Array.from({ length: 256 }, (_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const sat = new Float64Array((w + 1) * (h + 1));
  const cells = new Float64Array(w * h);
  const S5 = ${FIT_SOURCE};
  const full = document.createElement("canvas");
  const shown = document.getElementById("scene");
  full.width = shown.width; full.height = shown.height;
  const fctx = full.getContext("2d", { willReadFrequently: true });
  // The canvas as the window shows it (scaled up nearest-neighbour, as demo.css does), to blend the text layer over.
  const big = document.createElement("canvas");
  big.width = W; big.height = H;
  const bctx = big.getContext("2d", { willReadFrequently: true });
  bctx.imageSmoothingEnabled = false;
  window.__steps = {
    t: [], regions: [], burst: [], cacheKey: "", cache: new Map(), s5: { frames: 0, pixels: 0, bad: 0, worst: "" }, overlay: null, textSteps: 0,
    setOverlay(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.overlay = bytes;
      this.textSteps++;
    },
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
    // One frame's regions: the canvas under the text layer, blended in sRGB as the browser does (the layer's pixel is its colour
    // over black plus what the canvas shows through), averaged per cell in linear light.
    measure(ms) {
      bctx.drawImage(shown, 0, 0, W, H);
      const px = bctx.getImageData(0, 0, W, H).data;
      const ov = this.overlay;
      cells.fill(0);
      for (let y = 0; y < H; y++) {
        const row = Math.min(h - 1, Math.floor(y * h / H)) * w;
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          let r = px[i], g = px[i + 1], b = px[i + 2];
          if (ov !== null) {
            const through = 1 - ov[i + 3] / 255;
            r = Math.min(255, ov[i] + through * r); g = Math.min(255, ov[i + 1] + through * g); b = Math.min(255, ov[i + 2] + through * b);
          }
          cells[row + Math.min(w - 1, Math.floor(x * w / W))] += 0.2126 * lut[Math.round(r)] + 0.7152 * lut[Math.round(g)] + 0.0722 * lut[Math.round(b)];
        }
      }
      const per = (W / w) * (H / h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        sat[(y + 1) * (w + 1) + x + 1] = cells[y * w + x] / per + sat[y * (w + 1) + x + 1] + sat[(y + 1) * (w + 1) + x] - sat[y * (w + 1) + x];
      }
      this.check(ms);
      this.t.push(ms);
      this.regions.push(rects.map(([, x0, y0, x1, y1]) => {
        const [a, b, c, d] = [Math.round(x0 * w), Math.round(y0 * h), Math.round(x1 * w), Math.round(y1 * h)];
        return (sat[d * (w + 1) + c] - sat[b * (w + 1) + c] - sat[d * (w + 1) + a] + sat[b * (w + 1) + a]) / ((c - a) * (d - b));
      }));
      this.burst.push(window.__scene.burst);
    },
    begin(from, to, events) {
      const self = this;
      window.__scene.advance(Math.max(0, from - ${WARM_UP_S}) * 1000, from * 1000, 60, { draws: () => false, after() {} });
      window.__scene.begin(from * 1000, to * 1000, 60, { events: events || [], draws: () => true, after(ms) { self.measure(ms); } });
    },
    // The text layer's elements are hidden or shown for a screenshot, and put back: only styles, set one by one.
    cover(on) {
      shown.style.visibility = on === null ? "" : "hidden";
      document.documentElement.style.background = on === null ? "" : on;
      document.body.style.background = on === null ? "" : on;
    },
  };
})()`;

interface Series { t: number[]; regions: number[][]; burst: number[]; textSteps: number; s5: { frames: number; pixels: number; bad: number; worst: string } }
export interface Run {
  readonly frames: number;
  readonly burstFrames: number;
  /** The times the text layer was captured: the first frame and every frame on which the text stepped. */
  readonly textSteps: number;
  /** The most changes in any sliding second, over every region, and the region it is in. */
  readonly most: number;
  readonly worstRegion: string;
  readonly worstChanges: Change[];
  /** S5: pixels checked and pixels that are not `a x token + w x white`, over every frame of the run. */
  readonly s5: { readonly frames: number; readonly pixels: number; readonly bad: number; readonly worst: string };
  readonly byRegion: Record<string, number>;
}
export interface Counted { readonly moment: string; readonly state: string; readonly run: Run }

/** The text layer as it is now: its colour over black and its opacity, from a screenshot over black and one over white with the canvas hidden. */
async function captureText(page: Page): Promise<void> {
  assert.equal(await settleTransitions(page), 0, "a transition is still running: the text layer is not final");
  const shot = async (ground: string) => {
    await page.evaluate(`window.__steps.cover(${JSON.stringify(ground)})`);
    return decodePng(await page.screenshot({ type: "png" }));
  };
  const [black, white] = [await shot("#000"), await shot("#fff")];
  await page.evaluate("window.__steps.cover(null)");
  await page.evaluate(`window.__steps.setOverlay(${JSON.stringify(Buffer.from(overlayOf(black, white)).toString("base64"))})`);
}

async function play(open: Open, m: Moment, query: string): Promise<Run> {
  const { page, problems } = await open(480, 270, query + (m.cls === undefined ? "" : `&class=${m.cls}`));
  await page.evaluate(probeSetup);
  await page.evaluate(`window.__steps.begin(${m.fromS}, ${m.toS}, ${JSON.stringify(m.events ?? [])})`);
  // The page plays until the text steps in a drawn frame; the layer is captured then, and that frame measured with it.
  for (let done = false; !done; ) {
    const r = await page.evaluate(() => (window as unknown as { __scene: { resume(): { pending: number | null; done: boolean } } }).__scene.resume());
    if (r.pending !== null) {
      await captureText(page);
      await page.evaluate(`window.__steps.measure(${r.pending})`);
    }
    done = r.done;
  }
  const out = await page.evaluate(() => (window as unknown as { __steps: Series }).__steps);
  assert.deepEqual([...problems, ...(await violations(page))], [], m.name);
  await page.close();
  const changesOf = (r: number) => findChanges(out.t, out.regions.map((row) => row[r]!));
  const byRegion: Record<string, number> = {};
  REGIONS.forEach(([name], r) => { byRegion[name] = mostInASecond(changesOf(r)); });
  const [worstRegion, most] = Object.entries(byRegion).reduce((a, b) => (b[1] > a[1] ? b : a));
  const round = (c: Change): Change => ({ atMs: Math.round(c.atMs), rising: c.rising, from: Number(c.from.toFixed(4)), to: Number(c.to.toFixed(4)) });
  return { frames: out.t.length, burstFrames: out.burst.filter((b) => b > 0).length, textSteps: out.textSteps, most, worstRegion, s5: out.s5, worstChanges: changesOf(REGIONS.findIndex(([n]) => n === worstRegion)).map(round), byRegion };
}

/** Plays every moment in each state, reports the strict S6 count, and gates S5 on every frame. */
export async function reportS6(open: Open, artifacts: string): Promise<Counted[]> {
  const counted: Counted[] = [];
  const s5Faults: string[] = [];
  const s6Faults: string[] = [];
  const burstFaults: string[] = [];
  for (const m of MOMENTS) {
    const line: string[] = [];
    for (const [state, query] of STATES) {
      const run = await play(open, m, query);
      assert.ok(run.frames >= (m.frames ?? m.toS - m.fromS) * 55, `${m.name}, ${state}: only ${run.frames} frames measured`);
      if (run.s5.bad > 0) s5Faults.push(`${m.name}, ${state}: ${run.s5.bad} of ${run.s5.pixels} pixels are not a x token + w x white, for example ${run.s5.worst}`);
      if (run.most > MAX_CHANGES_PER_SECOND) s6Faults.push(`${m.name}, ${state}: ${run.most} changes in a second in ${run.worstRegion} (limit ${MAX_CHANGES_PER_SECOND})`);
      if ((m.bursts ?? []).includes(state) && run.burstFrames === 0) burstFaults.push(`${m.name}, ${state}: no white burst with the budget on`);
      counted.push({ moment: m.name, state, run });
      line.push(`${state} ${run.most} (${run.worstRegion}), bursts ${run.burstFrames} fr, text steps ${run.textSteps}, S5 ${run.s5.bad} of ${run.s5.pixels} px`);
    }
    console.log(`S6 report, ${m.name}: ${line.join(", ")} (limit ${MAX_CHANGES_PER_SECOND})`);
  }
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, "flash-steps.json"), JSON.stringify({ limitPerSecond: MAX_CHANGES_PER_SECOND, moments: counted }, null, 2));
  assert.deepEqual(s5Faults, [], "S5: a rendered pixel is not a x token + w x white");
  assert.deepEqual(s6Faults, [], "S6: more than 3 changes in a sliding second");
  assert.deepEqual(burstFaults, [], "the scene bursts where the scheduler has room");
  return counted;
}
