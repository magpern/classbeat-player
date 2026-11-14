// A fake of the site and its live process for the rider page's checks: recorded messages and
// answers, no network. Every request of the page goes through Playwright's router: the page's own
// files are served from dist/j/ with the companion page's headers (ADR 0007: "/j with the companion
// page's headers"), whose connect-src allows only the join route and the live socket; the join route
// answers from the test's script; the live WebSocket is a scripted fake; any other request is
// aborted and recorded. Chrome itself is cut off from every network as well (launchOffline).
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import type { Browser, BrowserContext, Page, WebSocketRoute } from "playwright-core";
import { DIST } from "./browser.ts";
import type { Reply, Seen } from "./companion-fake.ts";

export { launchOffline } from "./companion-fake.ts";
export const ORIGIN = "https://site.test";
export const PAGE_URL = `${ORIGIN}/j`;
export const TOKEN_KEY = "classbeat.rider.token";
export const NUMBERS_KEY = "classbeat.rider.numbers";

/** The rider page's policy: the companion's, with connect-src only the join route and the live socket. */
export const RIDER_CSP = `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src ${ORIGIN}/api/live/join wss://site.test/api/live/ws; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`;
const RIDER_DIR = join(DIST, "j");
const TYPES: Readonly<Record<string, string>> = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".html": "text/html; charset=utf-8" };

export interface FakeLive {
  readonly sent: string[];
  readonly urls: string[];
  send(message: unknown): void;
  close(code: number): Promise<void>;
  readonly open: boolean;
  /** Resolves once the current connection has said `hello` (and been welcomed); a state sent earlier is lost. */
  ready(): Promise<void>;
  /** While true, every new connection is closed at once. */
  refuse: boolean;
}

export interface RiderFake {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly live: FakeLive;
  /** Requests to /api/, in order. */
  readonly api: Seen[];
  /** Requests to anywhere but the site's own files and /api/ (aborted). */
  readonly external: string[];
  /** Console output, page errors, storage, history, fetch and CSP violations, as the init script saw them. */
  traps(): Promise<{ kind: string; detail: string }[]>;
}

export interface RiderOptions {
  readonly width: number;
  readonly height: number;
  /** The fragment, with its `#`; "" for none. Default `#KXPD-RMTB`. */
  readonly hash?: string;
  /** Answers of POST /api/live/join, in turn (the last one repeats). */
  readonly answers?: readonly Reply[];
  /** A rider token already in this tab's sessionStorage (a reload). */
  readonly stored?: string;
  /** What localStorage holds under the numbers key before the page loads. */
  readonly remembered?: string;
  /** localStorage throws on every use (a private window, blocked storage). */
  readonly noStorage?: boolean;
  /** Answer `hello` with this welcome's hostConnected; null: no welcome. */
  readonly welcome?: boolean | null;
  readonly clock?: boolean;
  readonly wake?: "granted" | "absent";
}

// Runs in the page before its own script; the init script is not subject to the page's CSP.
function instrument(o: { stored: string | null; remembered: string | null; noStorage: boolean; wake: string; tokenKey: string; numbersKey: string }): void {
  if (o.stored) sessionStorage.setItem(o.tokenKey, o.stored);
  if (o.remembered) localStorage.setItem(o.numbersKey, o.remembered);
  type Trap = { kind: string; detail: string };
  const traps: Trap[] = [];
  (globalThis as unknown as { __traps: Trap[] }).__traps = traps;
  const note = (kind: string, detail: unknown): void => void traps.push({ kind, detail: String(detail) });
  for (const name of ["setItem", "getItem", "removeItem", "clear", "key"] as const) {
    const orig = Storage.prototype[name] as (...a: unknown[]) => unknown;
    Storage.prototype[name] = function (this: Storage, ...a: unknown[]) {
      const local = this === localStorage;
      note("storage", `${local ? "local" : "session"} ${name} ${a.join(" ")}`);
      if (local && o.noStorage) throw new DOMException("blocked", "SecurityError");
      return orig.apply(this, a);
    } as never;
  }
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  Object.defineProperty(Document.prototype, "cookie", {
    get() {
      note("cookie", "read");
      return cookie?.get?.call(this);
    },
    set(v: string) {
      note("cookie", `write ${v}`);
      cookie?.set?.call(this, v);
    },
  });
  for (const k of ["log", "info", "warn", "error", "debug", "trace", "dir", "table"] as const) {
    console[k] = ((...a: unknown[]) => note("console", `${k} ${a.map(String).join(" ")}`)) as never;
  }
  addEventListener("error", (e) => note("error", e.message));
  for (const k of ["pushState", "replaceState"] as const) {
    const orig = History.prototype[k];
    History.prototype[k] = function (this: History, state: unknown, unused: string, url?: string | URL | null) {
      note("history", `${k} ${String(url ?? "")} from ${location.href}`);
      return orig.call(this, state, unused, url);
    };
  }
  const fetchy = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    note("fetch", `${init?.method ?? "GET"} ${String(input)} ${typeof init?.body === "string" ? init.body : ""}`);
    return fetchy(input, init);
  }) as typeof fetch;
  document.addEventListener("securitypolicyviolation", (e) => note("csp", `${e.violatedDirective} ${e.blockedURI}`));
  if (o.wake === "absent") delete (Navigator.prototype as unknown as { wakeLock?: unknown }).wakeLock;
  else {
    const sentinel = { released: false, release: async () => note("wake", "release"), addEventListener: () => undefined };
    Object.defineProperty(navigator, "wakeLock", { value: { request: (t: string) => (note("wake", `request ${t}`), Promise.resolve(sentinel)) } });
  }
}

function serveFile(path: string): { status: number; body: Buffer | string; contentType: string } {
  const rel = normalize(path.replace(/^\/j\/?/, "") || "index.html");
  if (rel.startsWith("..")) return { status: 404, body: "", contentType: "text/plain" };
  try {
    return { status: 200, body: readFileSync(join(RIDER_DIR, rel)), contentType: TYPES[extname(rel)] ?? "application/octet-stream" };
  } catch {
    return { status: 404, body: "", contentType: "text/plain" };
  }
}

export async function openRider(browser: Browser, o: RiderOptions): Promise<RiderFake> {
  const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, hasTouch: false });
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(instrument, { stored: o.stored ?? null, remembered: o.remembered ?? null, noStorage: o.noStorage ?? false, wake: o.wake ?? "granted", tokenKey: TOKEN_KEY, numbersKey: NUMBERS_KEY });
  const page = await context.newPage();
  const api: Seen[] = [];
  const external: string[] = [];
  let turn = 0;
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) {
      external.push(req.url());
      return route.abort();
    }
    if (url.pathname.startsWith("/api/")) {
      api.push({ method: req.method(), url: req.url(), body: req.postData(), headers: await req.allHeaders() });
      const list = url.pathname === "/api/live/join" ? o.answers : undefined;
      if (!list?.length) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      const r = list[Math.min(turn++, list.length - 1)];
      if (r.fail) return route.abort("internetdisconnected");
      return route.fulfill({ status: r.status, headers: { "content-type": "application/json", ...r.headers }, body: r.body === undefined ? "" : JSON.stringify(r.body) });
    }
    const f = serveFile(url.pathname);
    const cache = /\.(js|css|woff2)$/.test(url.pathname) ? "no-cache" : "no-store";
    const headers = { "Content-Security-Policy": RIDER_CSP, "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Cache-Control": cache };
    return route.fulfill({ status: f.status, contentType: f.contentType, body: f.body, headers });
  });
  let ws: WebSocketRoute | null = null;
  let greeted: WebSocketRoute | null = null;
  const live = {
    sent: [] as string[],
    urls: [] as string[],
    send(message: unknown): void {
      ws?.send(JSON.stringify(message));
    },
    async close(code: number): Promise<void> {
      const w = ws;
      ws = null;
      await w?.close({ code });
    },
    get open(): boolean {
      return ws !== null;
    },
    refuse: false,
    async ready(): Promise<void> {
      for (let i = 0; i < 300 && (ws === null || greeted !== ws); i++) await new Promise((r) => setTimeout(r, 20));
      if (ws === null || greeted !== ws) throw new Error("the page did not connect and say hello");
    },
  };
  await page.routeWebSocket(/.*/, (route) => {
    live.urls.push(route.url());
    if (live.refuse || route.url() !== "wss://site.test/api/live/ws") {
      void route.close({ code: 1008 });
      return;
    }
    ws = route;
    route.onMessage((m) => {
      const text = String(m);
      live.sent.push(text);
      const v = JSON.parse(text) as { type?: string };
      if (v.type === "hello") greeted = route;
      if (v.type === "hello" && o.welcome !== null) route.send(JSON.stringify({ v: 1, type: "welcome", role: "rider", hostConnected: o.welcome ?? true }));
    });
    route.onClose(() => {
      if (ws === route) ws = null;
    });
  });
  if (o.clock) {
    await page.clock.install({ time: new Date("2026-11-13T10:00:00Z") });
    await page.clock.pauseAt(new Date("2026-11-13T10:00:01Z"));
  }
  await page.goto(PAGE_URL + (o.hash ?? "#KXPD-RMTB"));
  return { page, context, live, api, external, traps: () => page.evaluate(() => (globalThis as unknown as { __traps: { kind: string; detail: string }[] }).__traps) };
}
