// The strict S6 gate on the plain screen (scene.md, "The flash budget"; docs/design/room-2d.md, "Motion
// and reduced motion"): a class played through the real room screen in headless Chrome, 60 frames a second
// on a clock the check steps, a snapshot at every frame; the page is read in linear light in the 40 regions
// of the measure, and the scene's own count (player/scene/render/tools/luminance-steps.ts) finds every
// monotone run over 10 % of its larger end, each direction, in any sliding second.
//
// A frame is read only when the page changed in it. That is exact because nothing on the screen changes
// between frames: no transition, no animation, no frame loop (read off the page at every changed frame
// with `moving()`, and from the number of `requestAnimationFrame` calls, which must be none).
import type { Browser } from "playwright-core";
import type { Scenario } from "../../src/fixtures/timeline.ts";
import { FRAME_MS } from "../../src/room/mark-gate.ts";
import { MAX_CHANGES_PER_SECOND, findChanges, mostInASecond } from "../../../player/scene/render/tools/luminance-steps.ts";
import type { Change } from "../../../player/scene/render/tools/luminance-steps.ts";
import { harnessUrl, newPage, settle } from "./browser.ts";
import { REGIONS, regionLuminance } from "./png-luminance.ts";

export { MAX_CHANGES_PER_SECOND };

export interface S6Run {
  /** The frames at which the screen changed after its first draw (ms on the stepped clock). */
  readonly marks: readonly number[];
  readonly frames: number;
  /** The most changes in any sliding second, over the 40 regions, and the region it is in. */
  readonly most: number;
  readonly worstRegion: string;
  readonly worstChanges: readonly Change[];
  /** Anything that transitioned or animated at a changed frame (must be empty). */
  readonly moving: readonly string[];
  /** `requestAnimationFrame` calls while the class ran (must be 0). */
  readonly rafCalls: number;
}

export async function playS6(browser: Browser, scenario: Scenario, size: readonly [number, number], reduced: boolean, seconds: number): Promise<S6Run> {
  const page = await newPage(browser, { width: size[0], height: size[1], reducedMotion: reduced });
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("file:")) external.push(r.url());
  });
  await page.route(/^(?!file:)/, (r) => r.abort());
  await page.addInitScript("window.__raf = 0; const r = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (f) => { if (window.__counting) window.__raf += 1; return r(f); };");
  try {
    await page.goto(harnessUrl("running", "virtual=1"));
    await page.evaluate(({ s, r }) => window.drive.begin(s, r), { s: scenario, r: reduced });
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    await page.evaluate(() => {
      window.drive.reset();
      (window as unknown as { __counting: boolean }).__counting = true;
    });
    const last = Math.round((seconds * 1000) / FRAME_MS);
    const read = async (): Promise<number[]> => regionLuminance(await page.screenshot({ type: "png" }));
    const series: number[][] = [await read()];
    const marks: number[] = [];
    const moving: string[] = [];
    for (let frame = 0; frame < last; ) {
      const stop: { frame: number; ms: number } | null = await page.evaluate((to) => window.drive.advance(to), last);
      if (stop === null) break;
      while (series.length < stop.frame) series.push(series[series.length - 1]);
      moving.push(...(await page.evaluate(() => window.drive.moving())));
      series.push(await read());
      marks.push(stop.ms);
      frame = stop.frame;
    }
    while (series.length <= last) series.push(series[series.length - 1]);
    const rafCalls = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
    if (external.length) throw new Error(`external request: ${external[0]}`);
    const times = series.map((_, k) => k * FRAME_MS);
    const changes = REGIONS.map((_, r) => findChanges(times, series.map((row) => row[r])));
    const counts = changes.map((c) => mostInASecond(c));
    const worst = counts.indexOf(Math.max(...counts));
    return { marks, frames: series.length, most: counts[worst], worstRegion: REGIONS[worst][0], worstChanges: changes[worst], moving, rafCalls };
  } finally {
    await page.context().close();
  }
}
