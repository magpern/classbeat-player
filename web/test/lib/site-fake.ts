// A fake of the site's backend for the website checks: recorded answers, no network. Every
// request of the page goes through Playwright's router: the site's own files are served from
// dist/site/ with the backend's page headers (the CSP of ADR 0002, section 5), /api/site/ routes
// answer from the test's script, and any other origin is aborted and recorded.
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page, Request, Route } from "playwright-core";
import { chromePath, DIST } from "./browser.ts";
import { instrument } from "./site-instrument.ts";
import { linkRequest } from "./site-mail.ts";
import type { Passkey } from "./site-instrument.ts";
import { passkeyStandIn } from "./site-passkey.ts";
import { trapKit } from "./site-trap-kit.ts";

export const ORIGIN = "https://site.test";
/** The backend's own header (backend/src/player_backend/request_policy.py); a drift test compares the two. */
export const CSP = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const SITE_DIR = join(DIST, "site");
const TYPES: Readonly<Record<string, string>> = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".html": "text/html; charset=utf-8" };

/**
 * Chrome for the website checks, cut off from every network: no proxy, every host name
 * unresolvable and no background services. The page's own requests never get that far: the
 * router below answers or aborts each one, so even a speculative connection reaches nothing.
 */
export function launchOffline(): Promise<Browser> {
  return chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--force-color-profile=srgb", "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND", "--disable-background-networking", "--disable-component-update", "--disable-domain-reliability", "--no-pings"],
  });
}

export interface Reply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** No answer: the request fails as it does offline. */
  readonly fail?: boolean;
  /** Held until the test calls release(): a request still waiting. */
  readonly hold?: boolean;
}

/** "POST sign-in/link" → the answer, or answers in turn (the last one repeats). */
export type Script = Readonly<Record<string, Reply | readonly Reply[]>>;

export interface Seen {
  readonly method: string;
  readonly route: string;
  readonly url: string;
  readonly body: string | null;
  readonly headers: Readonly<Record<string, string>>;
  /** When the fake saw it (`Date.now()`). */
  readonly at: number;
}

export interface FakeSite {
  readonly page: Page;
  readonly context: BrowserContext;
  /** Requests to /api/site/, in order. */
  readonly api: Seen[];
  /** Every URL the page asked for, of any origin. */
  readonly urls: string[];
  /** Requests to anywhere but the site (aborted). */
  readonly external: string[];
  /** API requests with no answer in the script (answered 500). */
  readonly unscripted: string[];
  /** API requests the backend would refuse as cross-site (answered 403 `cross_site_request`). */
  readonly crossSite: string[];
  /** Console output and page errors. */
  readonly console: string[];
  /**
   * Every other realm the page opened, seen from the browser's side, so no script in the page can
   * hide one: a frame (an iframe, even one removed at once), another page (a popup) or a dedicated
   * worker, or a service worker (#307). Shared and service workers are noted by the trap too (kind `realm`).
   * The trap is installed in the page's own realm only, so the checks require none (#293).
   */
  readonly realms: string[];
  release(): Promise<void>;
}

export type { Passkey };

export interface OpenOptions {
  readonly width: number;
  readonly height: number;
  readonly script?: Script;
  readonly passkey?: Passkey;
  /** The browser's default font size in px (16 is 100 %, 32 is 200 %). */
  readonly fontSize?: number;
  /** A script run in the page ahead of the trap; only the trap's own checks use it. */
  readonly before?: string;
  /**
   * Given, `POST sign-in/link` is answered by the fake's mail (site-mail.ts), and each mailed link
   * is added here, unless the script has an answer for that route: the script comes first, so a
   * test can script the per-address 429 (nothing is mailed then).
   */
  readonly mailbox?: string[];
  /** Install Playwright's clock, paused, before the page loads: time moves only when the test runs it on (page.clock.runFor). */
  readonly clock?: boolean;
  /** The system asks for reduced motion (prefers-reduced-motion: reduce). */
  readonly reducedMotion?: boolean;
}

/** Opens `path` on the fake site. */
export async function openSite(browser: Browser, path: string, o: OpenOptions): Promise<FakeSite> {
  const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, reducedMotion: o.reducedMotion ? "reduce" : "no-preference" });
  await context.addInitScript("globalThis.__name = (f) => f;");
  if (o.before) await context.addInitScript(o.before);
  // The trap, built from its kit, with the passkey stand-in; each is serialised as source text.
  await context.addInitScript(`(${instrument.toString()})(${JSON.stringify(o.passkey ?? "ok")}, (${trapKit.toString()})(), ${passkeyStandIn.toString()});`);
  const realms: string[] = [];
  context.on("serviceworker", (w) => realms.push(`serviceworker ${w.url()}`));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (o.fontSize && o.fontSize !== 16) await cdp.send("Page.setFontSizes", { fontSizes: { standard: o.fontSize, fixed: Math.round(o.fontSize * 0.8125) } });
  // The page's own address cannot be wrapped in the page (location's members are unforgeable), so a
  // `javascript:` address given to location.href, assign or replace is noted from the browser's
  // side, as the browser's URL parser read it (#315). `traps` adds these notes to the page's own.
  const fromBrowser: Trap[] = [];
  browserNotes.set(page, fromBrowser);
  // `Page.frameScheduledNavigation` is deprecated in the protocol; if a Chromium update drops it the
  // location tests (which expect this note) fail loudly rather than pass silently. Note also that
  // `navigation.navigate('javascript:...')` does not run in the pinned Chromium, so it needs no trap.
  cdp.on("Page.frameScheduledNavigation", (e) => {
    if (isJavascriptUrl(e.url)) fromBrowser.push({ kind: "script", detail: "navigation javascript:" });
  });
  await cdp.send("Page.enable");
  const site: FakeSite = { page, context, api: [], urls: [], external: [], unscripted: [], crossSite: [], console: [], realms, release: async () => undefined };
  const held: Route[] = [];
  const turns = new Map<string, number>();
  page.on("console", (m) => site.console.push(`${m.type()} ${m.text()}`));
  page.on("pageerror", (e) => site.console.push(`pageerror ${e.message}`));
  page.on("frameattached", (f) => site.realms.push(`frame ${f.name()}`));
  page.on("worker", (w) => site.realms.push(`worker ${w.url()}`));
  context.on("page", (p) => site.realms.push(`page ${p.url()}`));
  site.release = async () => {
    for (const r of held.splice(0)) await r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  };
  await page.route("**/*", async (route: Route, request: Request) => {
    const url = new URL(request.url());
    site.urls.push(request.url());
    if (url.origin !== ORIGIN) {
      site.external.push(request.url());
      return route.abort();
    }
    if (url.pathname.startsWith("/api/site/")) return answer(site, o.script ?? {}, turns, held, route, request, url, o.mailbox);
    return serveFile(route, url.pathname);
  });
  if (o.clock) {
    await page.clock.install({ time: new Date("2026-11-13T10:00:00Z") });
    await page.clock.pauseAt(new Date("2026-11-13T10:00:01Z"));
  }
  await page.goto(ORIGIN + path);
  await page.evaluate(() => document.fonts.ready);
  return site;
}

async function answer(site: FakeSite, script: Script, turns: Map<string, number>, held: Route[], route: Route, request: Request, url: URL, mailbox?: string[]): Promise<void> {
  const key = `${request.method()} ${url.pathname.slice("/api/site/".length)}`;
  const headers = await request.allHeaders();
  site.api.push({ method: request.method(), route: key, url: request.url(), body: request.postData(), headers, at: Date.now() });
  if (crossSite(request.method(), headers)) {
    site.crossSite.push(key);
    return route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"cross_site_request"}', headers: { "Cache-Control": "no-store" } });
  }
  if (mailbox && key === "POST sign-in/link" && !script[key]) return mailed(route, request, mailbox);
  const entry = script[key];
  if (!entry) {
    site.unscripted.push(key);
    return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"unscripted"}', headers: { "Cache-Control": "no-store" } });
  }
  const list = Array.isArray(entry) ? entry : [entry as Reply];
  const n = turns.get(key) ?? 0;
  turns.set(key, n + 1);
  const reply = list[Math.min(n, list.length - 1)];
  if (reply.fail) return route.abort("internetdisconnected");
  if (reply.hold) {
    held.push(route);
    return;
  }
  return route.fulfill({
    status: reply.status,
    headers: { "Cache-Control": "no-store", "Content-Security-Policy": CSP, ...(reply.body === undefined ? {} : { "Content-Type": "application/json" }), ...reply.headers },
    body: reply.body === undefined ? "" : JSON.stringify(reply.body),
  });
}

async function mailed(route: Route, request: Request, mailbox: string[]): Promise<void> {
  const a = linkRequest(ORIGIN, request.postData());
  if (a.link !== undefined) mailbox.push(a.link);
  return route.fulfill({ status: a.status, contentType: "application/json", body: JSON.stringify(a.body), headers: { "Cache-Control": "no-store" } });
}

/**
 * The backend's cross-site rule (backend/src/player_backend/request_policy.py,
 * `cross_site_refusal`): a state change needs `Origin` equal to the site's origin, and a
 * `Sec-Fetch-Site` other than `same-origin` is refused. The fake applies it to every request.
 *
 * What the browser checks observe: Playwright's interception does not show the `Sec-Fetch-*`
 * headers, so on a page request only the `Origin` half can refuse. The `Sec-Fetch-Site` half is
 * checked directly, as a table (site-page-security.test.ts).
 */
export function crossSite(method: string, headers: Readonly<Record<string, string>>): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) return false;
  if (headers["origin"] !== ORIGIN) return true;
  const fetchSite = headers["sec-fetch-site"];
  return fetchSite !== undefined && fetchSite !== "same-origin";
}

function serveFile(route: Route, pathname: string): Promise<void> {
  const rel = normalize(pathname).replace(/^[/\\]+/, "");
  // The companion page (served beside the site at /control) stands in as a plain page.
  if (rel === "control") return route.fulfill({ status: 200, headers: { "Content-Type": TYPES[".html"], "Content-Security-Policy": CSP, "Referrer-Policy": "no-referrer" }, body: "<!doctype html><title>Companion</title>" });
  // The web player page (ADR 0008) is built beside the site and served at /play: its page, and its own files.
  if (rel === "play" || rel.startsWith("play/")) return servePlay(route, rel);
  // Every address of the site is the one page; its scripts, styles and fonts are files.
  const file = /^(site\.(js|css)|fonts\/[\w.-]+\.woff2)$/.test(rel) ? rel : "index.html";
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Content-Security-Policy": CSP, "Referrer-Policy": "no-referrer" },
    body: readFileSync(join(SITE_DIR, file)),
  });
}

/** The files of the play page that are served beside it: its script, its three stylesheets and its fonts. */
export const PLAY_FILE = /^play\/(play\.js|(?:base|page|room)\.css|fonts\/[\w.-]+\.woff2)$/;

/** `/play` (and `/play/`) is the page; each of its own files is served with the site's headers; anything else under /play is not found. */
function servePlay(route: Route, rel: string): Promise<void> {
  const headers = { "Content-Security-Policy": CSP, "Referrer-Policy": "no-referrer" };
  const file = rel === "play" || rel === "play/" ? "index.html" : PLAY_FILE.test(rel) ? rel.slice("play/".length) : null;
  if (file === null) return route.fulfill({ status: 404, headers, body: "" });
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", ...headers },
    body: readFileSync(join(SITE_DIR, "play", file)),
  });
}

export interface Trap {
  readonly kind: string;
  readonly detail: string;
}

/** The notes made from the browser's side, by page. */
const browserNotes = new WeakMap<Page, Trap[]>();

function isJavascriptUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "javascript:";
  } catch {
    return false;
  }
}

/** The page's record as JSON text, from the trap's reader, reached through `window`: page code can replace `globalThis`, not `window`. */
function recorded(): string {
  return (window as unknown as { __traps: () => string }).__traps();
}

/** What the instrumentation recorded: in the page, then from the browser's side. */
export async function traps(page: Page): Promise<Trap[]> {
  const inPage = JSON.parse(await page.evaluate(recorded)) as Trap[];
  return [...inPage, ...(browserNotes.get(page) ?? [])];
}

/**
 * Waits until the page has settled, so a realm, request or trap that comes late is still seen
 * (#307): until nothing new is recorded for `quietMs` after two frames and a task in the page, or
 * `maxMs` has passed.
 */
export async function settled(site: FakeSite, quietMs = 300, maxMs = 3000): Promise<void> {
  const mark = async (): Promise<string> => {
    await site.page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0)))));
    const n = (await traps(site.page)).length;
    return [n, site.realms.length, site.urls.length, site.api.length, site.console.length].join(",");
  };
  const end = Date.now() + maxMs;
  let last = await mark();
  let since = Date.now();
  while (Date.now() < end && Date.now() - since < quietMs) {
    await site.page.waitForTimeout(50);
    const now = await mark();
    if (now !== last) [last, since] = [now, Date.now()];
  }
}

/** Waits until the page has made `n` API requests and they were answered. */
export async function waitForApi(site: FakeSite, n: number): Promise<void> {
  for (let i = 0; i < 200 && site.api.length < n; i += 1) await site.page.waitForTimeout(10);
  if (site.api.length < n) throw new Error(`expected ${n} API requests, saw ${site.api.map((a) => a.route).join(", ")}`);
  await site.page.waitForTimeout(30);
}
