// Runs the steady-light gate (tools/steady-shots.ts) on its own, for a moment or all of them: `npm run steady -- "interval change (20"`
// (arguments are the starts of moment names). `npm test` runs it on every moment; this is for working on one. Chrome as in tools/shots.ts.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { install } from "./guard-trap.ts";
import { reportSteady } from "./steady-shots.ts";
import { RENDER_DIR } from "./tokens-file.ts";

const PAGE = pathToFileURL(join(RENDER_DIR, "dist", "index.html")).href;
const CANDIDATES = ["/usr/bin/google-chrome", "/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const found = process.env.CHROME_PATH || CANDIDATES.find((p) => existsSync(p));
if (!found) throw new Error("No Chrome found: install Google Chrome or set CHROME_PATH");
const browser = await chromium.launch({ executablePath: found, args: ["--no-sandbox", "--force-color-profile=srgb", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const open = async (w: number, h: number, query: string) => {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) problems.push(`left the file system: ${r.url()}`); });
  await install(page);
  await page.goto(`${PAGE}?manual=1${query}`);
  await page.waitForFunction(() => "__scene" in window);
  return { page, problems };
};
const only = process.argv.slice(2);
try {
  await reportSteady(open, join(RENDER_DIR, "artifacts"), only.length > 0 ? only : undefined);
} finally {
  await browser.close();
}
