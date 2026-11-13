// The real class list page (dist/classlist.html) in headless Chrome, with a stand-in for the shell's
// bridge that serves a fixed view and records what the page asks for. No Electron, no network,
// no real account. Playwright drives the Chrome the machine already has; CHROME_PATH overrides it.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { ListView } from "../../src/core/list/view.ts";

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SHOT_DIR = join(APP_DIR, "screenshots");
const CANDIDATES = ["/usr/bin/google-chrome", "/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];

export function launchChrome(): Promise<Browser> {
  const found = process.env.CHROME_PATH || CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome found: install Google Chrome or set CHROME_PATH");
  return chromium.launch({ executablePath: found, args: ["--no-sandbox", "--force-color-profile=srgb"] });
}

/** The fixed time of every run: the "Today" and "Yesterday" of the Updated column do not drift. */
export const FIXED_NOW = new Date("2026-11-12T12:00:00Z");

export interface Opened {
  readonly page: Page;
  /** What the page asked the shell for, in order: ["start", id, hash], ["open"], ... */
  calls(): Promise<unknown[][]>;
  /** The view the next poll returns. */
  setView(v: ListView): Promise<void>;
  /** Requests that left the file system (there must be none). */
  readonly external: string[];
  readonly errors: string[];
  close(): Promise<void>;
}

const STUB = `
  window.__calls = [];
  window.__view = null;
  const answer = () => Promise.resolve(JSON.parse(JSON.stringify(window.__view)));
  window.player = {
    listView: answer,
    startClass: (id, hash) => { window.__calls.push(["start", id, hash]); return answer(); },
    openClassFile: () => { window.__calls.push(["open"]); return answer(); },
    dismissFileError: () => { window.__calls.push(["dismiss"]); return answer(); },
    backToClass: () => { window.__calls.push(["back"]); return answer(); },
    startPairing: () => { window.__calls.push(["pair"]); return Promise.resolve(window.__view.pairing); },
    reopenPairingPage: () => { window.__calls.push(["reopen"]); return Promise.resolve(window.__view.pairing); },
    unpair: () => { window.__calls.push(["cancel"]); return Promise.resolve(window.__view.pairing); },
  };
`;

export async function openList(browser: Browser, size: readonly [number, number], view: ListView, motion: "no-preference" | "reduce" = "no-preference"): Promise<Opened> {
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, reducedMotion: motion });
  await context.clock.setFixedTime(FIXED_NOW);
  // Code serialised into the page by `evaluate` may be wrapped by the transpiler's `__name` helper.
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(STUB);
  await context.addInitScript(`window.__view = ${JSON.stringify(view)};`);
  const page = await context.newPage();
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("file:")) external.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`file://${join(APP_DIR, "dist", "classlist.html")}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("#app[data-body]");
  return {
    page,
    external,
    errors,
    calls: () => page.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls),
    setView: (v) => page.evaluate((x) => void ((window as unknown as { __view: unknown }).__view = x), v),
    close: () => context.close(),
  };
}
