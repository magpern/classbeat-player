// CI's text-layer run (tools/shots.ts calls it): for each zone at 16:9, 16:10 and 4:3, a screenshot
// of the running room and the measured checks of scene.md on the real page: S1 cap heights, S2 the
// colour of every line over the scene, S15 the safe area and S16 overlaps; then S2's light
// measurement (the scene's relative luminance under every text box grown by 1.2 vh, over 120 frames
// and more covering a beat, a build, a drop and an interval change, in the brightest zones, with the
// mask and without it), and reduced motion. A failure names the zone, the size and the check.
import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { violations } from "./guard-trap.ts";
import { capsScript, coloursScript, lumSetup, maskCoverScript, overlapScript, safeAreaScript } from "./page-checks.ts";

export type Open = (w: number, h: number, query: string) => Promise<{ page: Page; problems: string[] }>;

const SIZES = [["16x9", 1920, 1080], ["16x10", 1280, 800], ["4x3", 1440, 1080]] as const;
/** A moment inside each zone's interval of the long demo class (demo/long-class.ts), mid-interval and on the beat grid. */
const ZONE_AT_S = [60, 180, 285, 355, 495, 575, 640] as const;
export const CAP = 0.08;

interface Api { __scene: { advance(a: number, b: number, fps: number, s?: { draws(ms: number): boolean; after(ms: number): void }): void; settle(): void } }
type Win = { from: number; to: number; what: string };

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => (window as unknown as Api).__scene.settle());
  await page.waitForTimeout(900); // the gel's colour transition (--m-change) runs on the real clock
}

/** Each zone at each size: the screenshot, and every measured check of the text layer. */
export async function zoneShots(open: Open, dir: string): Promise<void> {
  for (const [name, w, h] of SIZES) for (const [i, at] of ZONE_AT_S.entries()) {
    const zone = i + 1;
    const { page, problems } = await open(w, h, "&class=long");
    await page.evaluate(([a, b]) => (window as unknown as Api).__scene.advance(a! * 1000, b! * 1000, 60), [at - 6, at]);
    await settle(page);
    const where = `zone ${zone} at ${name}`;
    await page.screenshot({ path: join(dir, `text-zone-${zone}-${name}-${w}x${h}.png`) });
    assert.deepEqual(await page.evaluate(capsScript(name === "4x3")) as string[], [], `${where}: S1 text height`);
    assert.deepEqual(await page.evaluate(coloursScript) as string[], [], `${where}: S2 colour`);
    assert.deepEqual(await page.evaluate(safeAreaScript) as string[], [], `${where}: S15 safe area`);
    assert.deepEqual(await page.evaluate(overlapScript) as string[], [], `${where}: S16 overlap`);
    assert.deepEqual(await page.evaluate(maskCoverScript) as string[], [], `${where}: S2 text with no mask under it`);
    assert.deepEqual([...problems, ...(await violations(page))], [], where);
    await page.close();
  }
}

/** The worst case of "Fitting" (a five-glyph countdown, a pattern, 120-character cues, the widest name) in each link state at each size: every check holds. */
export async function worstCase(open: Open, dir: string): Promise<void> {
  for (const [name, w, h] of SIZES) for (const link of ["locked", "paused", "coasting", "off"]) {
    const { page, problems } = await open(w, h, `&class=worst&state=${link}`);
    await page.evaluate(() => (window as unknown as Api).__scene.advance(349_000, 355_000, 60));
    await settle(page);
    const where = `worst case, ${link}, at ${name}`;
    assert.deepEqual(await page.evaluate(capsScript(name === "4x3")) as string[], [], `${where}: S1 text height`);
    assert.deepEqual(await page.evaluate(coloursScript) as string[], [], `${where}: S2 colour`);
    assert.deepEqual(await page.evaluate(safeAreaScript) as string[], [], `${where}: S15 safe area`);
    assert.deepEqual(await page.evaluate(overlapScript) as string[], [], `${where}: S16 overlap`);
    assert.deepEqual(await page.evaluate(maskCoverScript) as string[], [], `${where}: S2 text with no mask under it`);
    assert.deepEqual([...problems, ...(await violations(page))], [], where);
    await page.screenshot({ path: join(dir, `text-worst-${link}-${name}-${w}x${h}.png`) });
    await page.close();
  }
}

/** The windows of the light measurement: an interval change, a beat, a build and a drop, in zones 4 and 7 (the brightest haze). */
function windows(change: number, beat: number, build: number, drop: number): Win[] {
  return [
    { from: change - 1.5, to: change + 0.5, what: "interval change" }, { from: beat, to: beat + 2, what: "beat" },
    { from: build, to: build + 2, what: "build" }, { from: drop - 0.5, to: drop + 1.5, what: "drop" },
  ];
}
const LIGHT_ZONES: readonly (readonly [number, Win[]])[] = [[4, windows(330, 340, 357, 360)], [7, windows(630, 640, 646, 650)]];

/** The highest relative luminance under the text over `frames` of windows (sampled every third frame at 60 fps). */
async function measureLight(open: Open, wins: Win[], query: string): Promise<{ max: number; frames: number; worst: string }> {
  const { page } = await open(1280, 720, `&class=long${query}`);
  await page.evaluate(lumSetup);
  await page.evaluate(() => document.fonts.ready);
  for (const win of wins) {
    await page.evaluate(`window.__lum.run(${win.from}, ${win.to}, ${JSON.stringify(win.what)})`);
  }
  const out = await page.evaluate(() => (window as unknown as { __lum: { max: number; frames: number; worst: string } }).__lum);
  await page.close();
  return out;
}

/** S2: the light under the text stays within the cap with the mask, and the same scene without it goes over (so the mask darkens real light). */
export async function lightMeasurement(open: Open): Promise<void> {
  for (const [zone, wins] of LIGHT_ZONES) {
    const on = await measureLight(open, wins, "");
    const off = await measureLight(open, wins, "&mask=0");
    console.log(`S2 zone ${zone}: ${on.frames} frames, highest luminance under text ${on.max.toFixed(4)} (${on.worst}); without the mask ${off.max.toFixed(4)} (${off.worst}); cap ${CAP}`);
    assert.ok(on.frames >= 120, `zone ${zone}: only ${on.frames} frames measured`);
    assert.ok(on.max <= CAP, `zone ${zone}: the light under the text reached ${on.max.toFixed(4)} (${on.worst}), over the cap ${CAP}`);
    assert.ok(off.max > CAP, `zone ${zone}: without the mask the light is only ${off.max.toFixed(4)}, so the measurement shows nothing`);
  }
}

/**
 * The reviewer's mutation: a text node over the scene that the layer did not register for the mask (what a cue built
 * without `ink()` is). The checks find text by walking the DOM, so each of them must fail on it.
 */
export async function unmaskedTextIsCaught(open: Open): Promise<void> {
  const { page } = await open(1280, 720, "&class=long");
  await page.evaluate(lumSetup);
  await page.evaluate(`(() => { const d = document.createElement("div"); d.textContent = "stray text"; d.style.cssText = "position:absolute;left:30vw;top:96vh;font-size:3vh;color:var(--light-1)"; document.getElementById("text").appendChild(d); })()`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(`window.__lum.run(358.5, 361, "unmasked text")`);
  const uncovered = await page.evaluate(maskCoverScript) as string[];
  const light = await page.evaluate(() => (window as unknown as { __lum: { max: number } }).__lum.max);
  await page.close();
  assert.ok(uncovered.some((u) => u.includes("stray text")), `the stray text has no mask box and the cover check must say so: ${JSON.stringify(uncovered)}`);
  assert.ok(light > CAP, `the light under the stray text is ${light.toFixed(3)} and the measurement must see it over the cap`);
}

/** Reduced motion: the layer carries it, and a colour change is instant (no transition on the gel). */
export async function reducedMotion(open: Open, dir: string): Promise<void> {
  const { page } = await open(1920, 1080, "&class=long&rm=1");
  await page.evaluate(() => (window as unknown as Api).__scene.advance(349_000, 355_000, 60));
  await settle(page);
  const state = await page.evaluate(() => {
    const root = document.getElementById("text")!;
    const gel = root.querySelector(".gel")!;
    return { rm: root.classList.contains("rm"), transition: getComputedStyle(gel).transitionDuration };
  });
  assert.equal(state.rm, true, "the text layer carries reduced motion");
  assert.match(state.transition, /^0s(, 0s)*$/, `the gel changes colour at once, not over ${state.transition}`);
  await page.screenshot({ path: join(dir, "text-reduced-motion-1920x1080.png") });
  await page.close();
}
