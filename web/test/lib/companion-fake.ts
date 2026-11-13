// A fake of the site and its live process for the companion page's checks: recorded messages and
// answers, no network. Every request of the page goes through Playwright's router: the page's own
// files are served from dist/control/ with the backend's page headers, /api/ routes answer from
// the test's script, the live WebSocket is a scripted fake, and any other request is aborted and
// recorded. Chrome itself is cut off from every network as well.
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page, WebSocketRoute } from "playwright-core";
import { DIST, chromePath } from "./browser.ts";

export const ORIGIN = "https://site.test";
export const PAGE_URL = `${ORIGIN}/control`;
/** The backend's own page headers (backend/src/player_backend/request_policy.py). */
export const CSP = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const CONTROL_DIR = join(DIST, "control");
const TYPES: Readonly<Record<string, string>> = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".html": "text/html; charset=utf-8" };

/** Chrome with no proxy, every host name unresolvable and no background services. */
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
}

export interface Seen {
  readonly method: string;
  readonly url: string;
  readonly body: string | null;
  readonly headers: Readonly<Record<string, string>>;
}

/** The fake live process: one scripted WebSocket at a time. */
export interface FakeLive {
  /** Every frame the page sent, in order, over every connection. */
  readonly sent: string[];
  /** The address of every connection the page opened. */
  readonly urls: string[];
  /** Sends a message to the page on the open connection. */
  send(message: unknown): void;
  /** Closes the open connection from the server's side. */
  close(code: number): Promise<void>;
  readonly open: boolean;
  /** While true, every new connection is closed at once (the phone cannot get through). */
  refuse: boolean;
}

export interface Fake {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly live: FakeLive;
  /** Requests to /api/, in order. */
  readonly api: Seen[];
  /** Requests to anywhere but the site's own files and /api/ (aborted). */
  readonly external: string[];
  /** Console output, page errors, storage, history and CSP violations, as the init script saw them. */
  traps(): Promise<{ kind: string; detail: string }[]>;
}

export interface OpenOptions {
  readonly width: number;
  readonly height: number;
  /** The fragment, with its `#`. */
  readonly hash?: string;
  /** `GET /api/site/sessions`: 200 when signed in, else 401. */
  readonly signedIn?: boolean;
  /** POST /api/live/controller and /control answers, in turn (the last one repeats). */
  readonly answers?: Partial<Record<"controller" | "control", readonly Reply[]>>;
  /** A token already in this tab's sessionStorage (a reload). */
  readonly stored?: string;
  /** Answer `hello` with this welcome's hostConnected; null: no welcome. */
  readonly welcome?: boolean | null;
  readonly reducedMotion?: boolean;
  /** Install Playwright's clock, paused, before the page loads. */
  readonly clock?: boolean;
  /** The page's Wake Lock: granted, refused, or absent. */
  readonly wake?: "granted" | "refused" | "absent";
}

// Runs in the page before its own script; the init script is not subject to the page's CSP.
function instrument(o: { stored: string | null; wake: string }): void {
  if (o.stored) sessionStorage.setItem("classbeat.companion.controller", o.stored);
  type Trap = { kind: string; detail: string };
  const traps: Trap[] = [];
  (globalThis as unknown as { __traps: Trap[] }).__traps = traps;
  const note = (kind: string, detail: unknown): void => void traps.push({ kind, detail: String(detail) });
  for (const name of ["setItem", "getItem", "removeItem", "clear"] as const) {
    const orig = Storage.prototype[name] as (...a: unknown[]) => unknown;
    Storage.prototype[name] = function (this: Storage, ...a: unknown[]) {
      note("storage", `${this === localStorage ? "local" : "session"} ${name} ${a.join(" ")}`);
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
    note("fetch", `${init?.method ?? "GET"} ${String(input)} from ${location.href}`);
    return fetchy(input, init);
  }) as typeof fetch;
  document.addEventListener("securitypolicyviolation", (e) => note("csp", `${e.violatedDirective} ${e.blockedURI}`));
  const nav = navigator as Navigator & { wakeLock?: unknown };
  if (o.wake === "absent") delete (Navigator.prototype as unknown as { wakeLock?: unknown }).wakeLock;
  else {
    const sentinel = { released: false, release: async () => note("wake", "release"), addEventListener: () => undefined };
    Object.defineProperty(nav, "wakeLock", {
      value: { request: (t: string) => (note("wake", `request ${t}`), o.wake === "refused" ? Promise.reject(new DOMException("no", "NotAllowedError")) : Promise.resolve(sentinel)) },
    });
  }
}

function serveFile(path: string): { status: number; body: Buffer | string; contentType: string } {
  // The website's sign-in page (issue #144) stands in as a plain page.
  if (path === "/sign-in") return { status: 200, body: "<!doctype html><title>Sign in</title>", contentType: TYPES[".html"] };
  const rel = normalize(path.replace(/^\/control\/?/, "") || "index.html");
  if (rel.startsWith("..")) return { status: 404, body: "", contentType: "text/plain" };
  try {
    return { status: 200, body: readFileSync(join(CONTROL_DIR, rel)), contentType: TYPES[extname(rel)] ?? "application/octet-stream" };
  } catch {
    return { status: 404, body: "", contentType: "text/plain" };
  }
}

export async function openCompanion(browser: Browser, o: OpenOptions): Promise<Fake> {
  const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, reducedMotion: o.reducedMotion ? "reduce" : "no-preference", hasTouch: false });
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(instrument, { stored: o.stored ?? null, wake: o.wake ?? "granted" });
  const page = await context.newPage();
  const api: Seen[] = [];
  const external: string[] = [];
  const turns = { controller: 0, control: 0 };
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) {
      external.push(req.url());
      return route.abort();
    }
    if (url.pathname.startsWith("/api/")) {
      api.push({ method: req.method(), url: req.url(), body: req.postData(), headers: await req.allHeaders() });
      if (url.pathname === "/api/site/sessions") return route.fulfill({ status: o.signedIn ? 200 : 401, contentType: "application/json", body: JSON.stringify(o.signedIn ? { sessions: [] } : { error: "not_signed_in" }) });
      const which = url.pathname === "/api/live/controller" ? "controller" : url.pathname === "/api/live/control" ? "control" : null;
      const list = which ? o.answers?.[which] : undefined;
      if (!which || !list?.length) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      const r = list[Math.min(turns[which]++, list.length - 1)];
      if (r.fail) return route.abort("internetdisconnected");
      return route.fulfill({ status: r.status, headers: { "content-type": "application/json", ...r.headers }, body: r.body === undefined ? "" : JSON.stringify(r.body) });
    }
    const f = serveFile(url.pathname);
    return route.fulfill({ status: f.status, contentType: f.contentType, body: f.body, headers: { "content-security-policy": CSP, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } });
  });
  let ws: WebSocketRoute | null = null;
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
  };
  await page.routeWebSocket(/.*/, (route) => {
    live.urls.push(route.url());
    if (live.refuse || !route.url().startsWith("wss://site.test/api/live/ws")) {
      void route.close({ code: 1008 });
      return;
    }
    ws = route;
    route.onMessage((m) => {
      const text = String(m);
      live.sent.push(text);
      const v = JSON.parse(text) as { type?: string };
      if (v.type === "hello" && o.welcome !== null) route.send(JSON.stringify({ v: 1, type: "welcome", role: "controller", slot: 1, hostConnected: o.welcome ?? true }));
    });
    route.onClose(() => {
      if (ws === route) ws = null;
    });
  });
  if (o.clock) {
    // Paused: time moves only when the test runs it on (page.clock.runFor).
    await page.clock.install({ time: new Date("2026-11-13T10:00:00Z") });
    await page.clock.pauseAt(new Date("2026-11-13T10:00:01Z"));
  }
  await page.goto(PAGE_URL + (o.hash ?? ""));
  return { page, context, live, api, external, traps: () => page.evaluate(() => (globalThis as unknown as { __traps: { kind: string; detail: string }[] }).__traps) };
}
