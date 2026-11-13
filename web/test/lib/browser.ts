// Headless Chrome for the screen checks. Playwright drives the Chrome the machine already has
// (CI's runners and the usual desktop installs); CHROME_PATH overrides it. No browser download.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";

export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DIST = join(WEB_DIR, "dist");

const CANDIDATES = ["/usr/bin/google-chrome", "/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];

export function chromePath(): string {
  const found = process.env.CHROME_PATH || CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome found: install Google Chrome or set CHROME_PATH");
  return found;
}

export function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox", "--force-color-profile=srgb"] });
}

export interface PageOptions {
  readonly width: number;
  readonly height: number;
  readonly reducedMotion?: boolean;
}

/** A page at a size. Code serialised into it by `evaluate` may be wrapped by a transpiler's `__name` helper. */
export async function newPage(browser: Browser, o: PageOptions): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, reducedMotion: o.reducedMotion ? "reduce" : "no-preference" });
  await context.addInitScript("globalThis.__name = (f) => f;");
  return context.newPage();
}

export function harnessUrl(fixture: string, extra = "freeze=1"): string {
  return `file://${join(DIST, "harness.html")}?fixture=${encodeURIComponent(fixture)}&${extra}`;
}

/** Two animation frames: a style change is painted before the next screenshot. */
export const settle = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
