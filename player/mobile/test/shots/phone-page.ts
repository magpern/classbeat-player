// The phone app's pages as shipped (build-config.mjs, src/page.ts with its CSP), built into a temporary
// folder and opened from files in headless Chrome, with a stand-in for Capacitor's native bridge that
// answers instructor mode's calls from fixed values and records them (issue #871). No device, no
// network, no account. Playwright drives the Chrome the machine already has; CHROME_PATH overrides it.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import { buildOptions } from "../../build-config.mjs";
import { PAGES, pageHtml, type PageName } from "../../src/page.ts";

export const MOBILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Kept by CI as `app-screenshots` (#875). */
export const SHOT_DIR = join(MOBILE, "screenshots");
const CANDIDATES = ["/usr/bin/google-chrome", "/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];

export function launchChrome(): Promise<Browser> {
  const found = process.env.CHROME_PATH || CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome found: install Google Chrome or set CHROME_PATH");
  return chromium.launch({ executablePath: found, args: ["--no-sandbox", "--force-color-profile=srgb"] });
}

/** Builds the pages as build.mjs does, into a new temporary folder; returns it and how to remove it. */
export async function buildSite(swift?: string): Promise<{ dir: string; remove: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "classbeat-mobile-shots-"));
  await build({ ...buildOptions(dir, swift), absWorkingDir: MOBILE, logLevel: "silent" });
  for (const name of Object.keys(PAGES) as PageName[]) writeFileSync(join(dir, name), pageHtml(name));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** What native code answers, by method; a method not named here never settles (as a refused call would not matter). */
export type Answers = Readonly<Record<string, unknown>>;

// The parts of Capacitor's native bridge that @capacitor/core reads (PluginHeaders, nativePromise):
// only instructor mode's plugin, with the methods the pages call.
const BRIDGE = `
  window.__native = [];
  window.Capacitor = {
    PluginHeaders: [{ name: "InstructorMode", methods: ["askRiderMode", "listClasses", "getClass", "syncNow", "unpair", "pairAgain", "followAccess", "openFollowSetting", "follow", "unfollow", "reading", "sendPlay", "sendPause", "sendNext"].map((name) => ({ name, rtype: "promise" })) }],
    nativePromise: (plugin, method, options) => {
      window.__native.push([plugin, method, options ?? null]);
      if (!(method in window.__answers)) return new Promise(() => {});
      return Promise.resolve(JSON.parse(JSON.stringify(window.__answers[method])));
    },
  };
`;

export interface PhonePage {
  readonly page: Page;
  /** The native calls the pages made, in order: [plugin, method, options]. */
  native(): Promise<unknown[][]>;
  readonly errors: string[];
  /** Requests that left the built files (there must be none). */
  readonly external: string[];
  close(): Promise<void>;
}

/** Opens [path] of the built site (with its query and fragment) at [size], time paused. */
export async function openPhonePage(browser: Browser, dir: string, path: string, size: readonly [number, number], answers: Answers, platform: "web" | "ios" = "web"): Promise<PhonePage> {
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, hasTouch: true });
  // Code serialised into the page by `evaluate` may be wrapped by the transpiler's `__name` helper.
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(`window.__answers = ${JSON.stringify(answers)};`);
  // Capacitor reads the platform from the web view: WKWebView's message handler is what says iOS.
  if (platform === "ios") await context.addInitScript("window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };");
  await context.addInitScript(BRIDGE);
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-11-26T18:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-26T18:00:01Z"));
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => {
    if (!r.url().startsWith("file:")) external.push(r.url());
  });
  await page.goto(`file://${join(dir, path)}`);
  return {
    page,
    errors,
    external,
    native: () => page.evaluate(() => (window as unknown as { __native: unknown[][] }).__native),
    close: () => context.close(),
  };
}

/** Saves a picture of the page as screenshots/<name>.png. */
export async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
}
