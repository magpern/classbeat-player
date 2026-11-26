// `setQuality` of the room window's mount (join/mount.ts) at run time: the join's frame-rate monitor steps the level down on a slow
// machine and hands each level to the real renderer, whose render scale shows in the canvas's drawing size (scene.md "Quality levels").
// A page with a hand-driven clock plays 20 frames a second through High, Medium and Low; a mount that did not pass a level on would leave
// the canvas at the High size. No network, no real account: the page is the built one in dist/.
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser } from "playwright-core";
import { QUALITY } from "../../model/src/index.ts";
import { install, violations } from "./guard-trap.ts";
import { RENDER_DIR } from "./tokens-file.ts";

const PAGE = pathToFileURL(join(RENDER_DIR, "dist", "join-quality.html")).href;
const [W, H] = [960, 540];
interface State { width: number; height: number; mode: string; why: string | null; level: string }
interface Api { __join: { step(ms: number): void; state(): State } }

export async function joinStepsTheQuality(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) problems.push(`left the file system: ${r.url()}`); });
  await install(page);
  await page.goto(PAGE);
  await page.waitForFunction(() => "__join" in window);
  // 50 ms a frame is 20 frames a second: under every level's threshold, so each one gives way after 5 s and Low gives way to the plain screen.
  const steps = (n: number) => page.evaluate((count) => { const j = (window as unknown as Api).__join; const seen: State[] = []; for (let i = 0; i < count; i++) { j.step(50); seen.push(j.state()); } return seen; }, n);
  const seen = await steps(400);
  const widths = seen.map((s) => s.width).filter((w, i, all) => i === 0 || w !== all[i - 1]);
  const want = (["High", "Medium", "Low"] as const).map((l) => Math.floor(W * QUALITY[l].renderScale));
  assert.deepEqual(widths, want, "the canvas is drawn at High, then Medium, then Low as the join steps the level down");
  const last = seen.at(-1)!;
  assert.equal(last.mode, "off", `the plain screen shows once Low is too slow too (${last.why})`);
  const trapped = await violations(page);
  await page.close();
  // After the close, so an error raised after the last check (a late frame, a rejected promise) is still collected.
  assert.deepEqual([...problems, ...trapped], [], "the join page raised errors or tripped the guard");
}
