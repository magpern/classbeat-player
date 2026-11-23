// CI's scene run, in headless Chrome on the built demo page (dist/), no network and no real account:
//  1. Screenshots of the scene in each state at two room sizes, for the Designer (screenshots/), and
//     of the text layer in each zone at 16:9, 16:10 and 4:3 with its measured checks (text-shots.ts).
//  2. The browser frame log: a real-time run through a phrase flip, a song change from a mirrored
//     phrase and a build with its drop, at the page's own frame times, recording the highest beam
//     speed of each second (artifacts/frame-log-browser.csv). The run fails above 30 degrees a second
//     (with 2 percent for timing), and fails if the transitions were not played.
// Chrome comes from the machine (CHROME_PATH overrides); WebGL is software (SwiftShader).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import { LIMIT_DEG_PER_SECOND } from "./frame-log.ts";
import { install, selfTest, violations } from "./guard-trap.ts";
import type { LogRow, Seen } from "./frame-log.ts";
import { beamFloor } from "./beam-floor-shots.ts";
import { reportS6 } from "./flash-shots.ts";
import { settleTransitions } from "./settle.ts";
import { lightMeasurement, reducedMotion, unmaskedTextIsCaught, worstCase, zoneShots } from "./text-shots.ts";
import { reportShared } from "./shared-shots.ts";
import { RENDER_DIR } from "./tokens-file.ts";

const PAGE = pathToFileURL(join(RENDER_DIR, "dist", "index.html")).href;
const SHOTS = join(RENDER_DIR, "screenshots");
const ARTIFACTS = join(RENDER_DIR, "artifacts");
const CANDIDATES = ["/usr/bin/google-chrome", "/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];
// The song change at 60 s is also an interval change into a song with no moments, so it bursts too.
const BURST_SHOTS = ["drop-burst", "light-burst"];
const SIZES = [[1920, 1080], [1366, 768]] as const;

interface Shot { /** Seconds played undrawn before `fromS`: a page that jumps from its first frame to a later moment bursts on the jump, and the next burst keeps 10 s from it. */ readonly warmS?: number; readonly name: string; readonly query: string; readonly fromS: number; readonly toS: number; /** The lit share the shot must still have (default 1 %): the house look before the start is two beams at 6 %. */ readonly minLit?: number }
// Each plays from `fromS` to `toS` on a synthetic 60 fps clock, so a screenshot is the same every time.
const SHOTS_LIST: readonly Shot[] = [
  { name: "warm-up-zone-1", query: "", fromS: 0, toS: 5 },
  { name: "zone-2-beat", query: "", fromS: 23, toS: 29.5 },
  { name: "anticipation", query: "", fromS: 32, toS: 35.6 },
  { name: "build-gather", query: "", fromS: 33, toS: 39.6 },
  // The drop at 58 s, away from an interval change, locked with the beat and the budget on: the burst the product places (the 40 s drop is on a change, where the ramp has the room).
  { name: "drop-burst", query: "", fromS: 56, toS: 58.05 },
  // A light-only burst on the interval change at 80 s in a song with no moments, where nothing competes (coasting, no ramp), the budget on.
  { name: "light-burst", query: "&state=coasting", fromS: 78, toS: 80.05, warmS: 12 },
  { name: "drop-fan", query: "", fromS: 38, toS: 45 },
  // A song change away from an interval change (the demo's `class=dim`, at 70 s), where the countdown's tick every second leaves the scheduler no room for the dim's two edges (step g): no dim, the rig stays at full level and the re-aim marks the song.
  { name: "song-change-dim", query: "&class=dim", fromS: 68, toS: 70.3 },
  { name: "breakdown", query: "", fromS: 112, toS: 122 },
  // The house look before the start (#546).
  { name: "before-the-start-house", query: "&stage=before", fromS: 0, toS: 5, minLit: 0.001 },
  { name: "zone-7-peak", query: "", fromS: 100, toS: 106 },
  { name: "paused", query: "&state=paused", fromS: 30, toS: 36 },
  { name: "coasting-none-level", query: "&state=coasting", fromS: 30, toS: 38 },
  { name: "off-the-list-holding", query: "&state=off", fromS: 36, toS: 44 },
  { name: "reduced-motion-still-rig", query: "&rm=1", fromS: 30, toS: 38 },
  { name: "quality-medium", query: "&q=Medium", fromS: 23, toS: 29.5 },
  { name: "quality-low", query: "&q=Low", fromS: 23, toS: 29.5 },
];

function launch(): Promise<Browser> {
  const found = process.env.CHROME_PATH || CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome found: install Google Chrome or set CHROME_PATH");
  return chromium.launch({ executablePath: found, args: ["--no-sandbox", "--force-color-profile=srgb", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
}

interface Api { __scene: { advance(a: number, b: number, fps: number, options?: { draws: () => boolean; after: () => void }): void; log: { rows: LogRow[]; seen: Seen; failures: LogRow[]; csv(): string; peakOverall: number }; missingTokens: string[]; ended: boolean; burst: number; master: number } }

async function open(browser: Browser, w: number, h: number, query: string): Promise<{ page: Page; problems: string[] }> {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) problems.push(`left the file system: ${r.url()}`); });
  await install(page);
  await page.goto(`${PAGE}?manual=1${query}`);
  await page.waitForFunction(() => "__scene" in window);
  return { page, problems };
}

/** Mean luminance (0 to 1) and the share of lit pixels of what the canvas holds. */
async function brightness(page: Page): Promise<{ mean: number; lit: number }> {
  return page.evaluate(() => {
    const src = document.getElementById("scene") as HTMLCanvasElement;
    const c = document.createElement("canvas");
    c.width = 160; c.height = 90;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      const y = (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / 255;
      sum += y;
      if (y > 0.02) lit++;
    }
    return { mean: sum / (px.length / 4), lit: lit / (px.length / 4) };
  });
}

async function screenshots(browser: Browser): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const means = new Map<string, number>();
  for (const [w, h] of SIZES) for (const shot of SHOTS_LIST) {
    const { page, problems } = await open(browser, w, h, shot.query);
    // A string, not a function: the bundler's helpers do not exist in the page.
    const warm = shot.warmS ?? 0;
    await page.evaluate(`(() => {
      const scene = window.__scene;
      if (${warm} > 0) scene.advance(${Math.max(0, shot.fromS - warm) * 1000}, ${shot.fromS * 1000}, 60, { draws: () => false, after() {} });
      scene.advance(${shot.fromS * 1000}, ${shot.toS * 1000}, 60);
    })()`);
    const b = await brightness(page);
    const burst = await page.evaluate(() => (window as unknown as Api).__scene.burst);
    assert.equal(burst > 0, BURST_SHOTS.includes(shot.name), `${shot.name}: burst ${burst}`);
    if (shot.name === "song-change-dim") assert.equal(await page.evaluate(() => (window as unknown as Api).__scene.master), 1, "no song-change dim: the scheduler has no room for both edges beside the countdown's ticks (step g)");
    assert.equal(await settleTransitions(page), 0, `${shot.name}: a transition is still running, so the shot would be caught half way`);
    await page.screenshot({ path: join(SHOTS, `${shot.name}-${w}x${h}.png`) });
    if (w === 1920) means.set(shot.name, b.mean);
    assert.deepEqual([...problems, ...(await violations(page))], [], `${shot.name}: ${problems.join("; ")}`);
    assert.ok(b.lit > (shot.minLit ?? 0.01), `${shot.name} at ${w}x${h} is blank (${b.lit} of the pixels lit)`);
    await page.close();
  }
  const m = (n: string) => means.get(n)!;
  assert.ok(m("paused") < m("zone-2-beat") * 0.2, "paused: lights down");
  assert.ok(m("off-the-list-holding") < m("drop-fan"), "off the list has no fan and no burst");
  assert.ok(m("drop-burst") > m("zone-2-beat") * 1.5, "the drop's white burst is the brightest moment");
  assert.ok(m("quality-low") > 0, "low quality still draws");
}

async function browserFrameLog(browser: Browser, query: string, name: string): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } }); // the beams' speed does not depend on the size; software GL draws the fullscreen shader slowly
  await install(page);
  await page.goto(`${PAGE}?auto=1&t=10&to=70&speed=3${query}`); // the beams' speed through every transition, bursts included; at 3 times (about 20 s) a slow runner still logs the 8 seconds asserted below (at 6 times it logged 7)
  await page.waitForFunction(() => (window as unknown as Api).__scene?.ended === true, undefined, { timeout: 120_000, polling: 250 });
  const out = await page.evaluate(() => { const l = (window as unknown as Api).__scene.log; return { rows: l.rows, seen: l.seen, failures: l.failures, csv: l.csv(), peak: l.peakOverall }; });
  writeFileSync(join(ARTIFACTS, `${name}.csv`), out.csv);
  writeFileSync(join(ARTIFACTS, `${name}.json`), JSON.stringify({ limitDegPerSecond: LIMIT_DEG_PER_SECOND, seen: out.seen, rows: out.rows }, null, 2));
  assert.ok(out.rows.length >= 8, `the run logged ${out.rows.length} seconds`);
  assert.ok(out.seen.phraseFlips >= 1 && out.seen.songChangesFromMirrored >= 1 && out.seen.gathers >= 1 && out.seen.drops >= 1 && out.seen.bursts >= 1, `without the transitions the check measures nothing: ${JSON.stringify(out.seen)}`);
  assert.deepEqual(out.rows.filter((r) => r.peakDegPerSecond > LIMIT_DEG_PER_SECOND), [], `a beam went over 30 degrees a second (peak ${out.peak})`);
  assert.deepEqual(await violations(page), [], "the real-time run triggered the runtime trap or the content-security policy");
  await page.close();
}

/** The trap and the page's policy fire on the Reviewer's bypass (an audio element, an image with an https src, ...). */
async function trapSelfTest(browser: Browser): Promise<void> {
  const page = await browser.newPage();
  const requests: string[] = [];
  // A request the policy blocks never gets a response; a request that left would.
  page.on("response", (r) => { if (!/^(file|data|blob):/.test(r.url())) requests.push(r.url()); });
  await install(page);
  await page.goto(`${PAGE}?manual=1`);
  await page.waitForFunction(() => "__scene" in window);
  assert.deepEqual(await violations(page), [], "a clean page has no violation");
  const seen = await selfTest(page);
  for (const want of ["createElement(audio)", "setAttribute(autoplay)", "new Audio", "new Image", "fetch", "navigator.sendBeacon", "WebSocket", "XMLHttpRequest.open", "createElement(script)", "createElement(iframe)", "new SpeechSynthesisUtterance", "new FontFace", "Range.createContextualFragment", "csp: img-src https://example.invalid/parsed.png", "csp: img-src https://example.invalid/bg.png"]) {
    assert.ok(seen.some((s) => s.startsWith(want)), `the trap missed ${want}; it recorded ${JSON.stringify(seen)}`);
  }
  assert.deepEqual(requests, [], "nothing was answered from outside the file system, not even the bypass");
  await page.close();
}

const browser = await launch();
try {
  await trapSelfTest(browser);
  await screenshots(browser);
  const opener = (w: number, h: number, query: string) => open(browser, w, h, query);
  await zoneShots(opener, SHOTS);
  await worstCase(opener, SHOTS);
  await lightMeasurement(opener);
  await beamFloor(opener); // S5b: the house look's beams keep their floor, and the check fails the look without it
  await reportS6(opener, ARTIFACTS);
  await unmaskedTextIsCaught(opener);
  await reducedMotion(opener, SHOTS);
  await browserFrameLog(browser, "&budget=off", "frame-log-browser"); // every run fits: the beams' speed through every burst the scheduler might skip
  await browserFrameLog(browser, "", "frame-log-browser-budget-on"); // the product's own: the ramps and bursts the scheduler places
  await reportShared(opener, ARTIFACTS); // the shared 1, last so that every other gate has run: the sway, the sweeps and a burst's decay count at most 1 in any second
  console.log(`scene shots: ${SHOTS_LIST.length * SIZES.length} scene and 34 text screenshots in ${SHOTS}; frame log in ${ARTIFACTS}`);
} finally {
  await browser.close();
}
