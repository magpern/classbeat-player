// A fake of the site's backend for the website checks: recorded answers, no network. Every
// request of the page goes through Playwright's router: the site's own files are served from
// dist/site/ with the backend's page headers (the CSP of ADR 0002, section 5), /api/site/ routes
// answer from the test's script, and any other origin is aborted and recorded.
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page, Request, Route } from "playwright-core";
import { chromePath, DIST } from "./browser.ts";

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
  release(): Promise<void>;
}

export type Passkey = "ok" | "cancel" | "hold" | "absent";

export interface OpenOptions {
  readonly width: number;
  readonly height: number;
  readonly script?: Script;
  readonly passkey?: Passkey;
  /** The browser's default font size in px (16 is 100 %, 32 is 200 %). */
  readonly fontSize?: number;
}

// Runs in the page before its own script (Playwright's init script is not subject to the page's CSP).
// It records what the checks need and stands in for the passkey prompt.
function instrument(mode: Passkey): void {
  type Trap = { kind: string; detail: string };
  const traps: Trap[] = [];
  (globalThis as unknown as { __traps: Trap[] }).__traps = traps;
  const note = (kind: string, detail: unknown): void => {
    traps.push({ kind, detail: String(detail) });
  };
  for (const name of ["setItem", "getItem", "removeItem", "clear", "key"] as const) {
    const orig = Storage.prototype[name] as (...a: unknown[]) => unknown;
    Storage.prototype[name] = function (this: Storage, ...a: unknown[]) {
      note("storage", `${name} ${a.join(" ")}`);
      return orig.apply(this, a);
    } as never;
  }
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  Object.defineProperty(Document.prototype, "cookie", {
    get() { note("cookie", "read"); return cookie?.get?.call(this); },
    set(v: string) { note("cookie", `write ${v}`); cookie?.set?.call(this, v); },
  });
  const idb = indexedDB.open.bind(indexedDB);
  indexedDB.open = ((n: string, v?: number) => { note("indexeddb", n); return idb(n, v); }) as typeof indexedDB.open;
  if (globalThis.caches) {
    const open = caches.open.bind(caches);
    caches.open = (n: string) => { note("cache", n); return open(n); };
  }
  for (const k of ["log", "info", "warn", "error", "debug", "trace", "dir", "table"] as const) {
    console[k] = ((...a: unknown[]) => note("console", `${k} ${a.map(String).join(" ")}`)) as never;
  }
  for (const k of ["pushState", "replaceState"] as const) {
    const orig = History.prototype[k];
    History.prototype[k] = function (this: History, state: unknown, unused: string, url?: string | URL | null) {
      note("history", `${k} ${String(url ?? "")}`);
      return orig.call(this, state, unused, url);
    };
  }
  document.addEventListener("securitypolicyviolation", (e) => note("csp", `${e.violatedDirective} ${e.blockedURI}`));
  // The passkey prompt.
  if (mode === "absent") {
    delete (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    return;
  }
  const bytes = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
  const get = (options?: CredentialRequestOptions): Promise<Credential | null> => {
    const pk = options?.publicKey;
    const challenge = pk ? new Uint8Array(pk.challenge as ArrayBuffer) : new Uint8Array();
    note("passkey", `get challenge=${[...challenge].join(",")} allow=${pk?.allowCredentials?.length ?? "none"} uv=${pk?.userVerification ?? ""} rp=${pk?.rpId ?? ""}`);
    if (mode === "hold") return new Promise(() => undefined);
    if (mode === "cancel") return Promise.reject(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"));
    return Promise.resolve({
      id: "Y3JlZC0x",
      type: "public-key",
      rawId: bytes("cred-1"),
      authenticatorAttachment: "platform",
      response: { clientDataJSON: bytes('{"type":"webauthn.get"}'), authenticatorData: bytes("auth"), signature: bytes("sig"), userHandle: bytes("user") },
    } as unknown as Credential);
  };
  Object.defineProperty(navigator.credentials, "get", { value: get });
}

/** Opens `path` on the fake site. */
export async function openSite(browser: Browser, path: string, o: OpenOptions): Promise<FakeSite> {
  const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(instrument, o.passkey ?? "ok");
  const page = await context.newPage();
  if (o.fontSize && o.fontSize !== 16) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: o.fontSize, fixed: Math.round(o.fontSize * 0.8125) } });
  }
  const site: FakeSite = { page, context, api: [], urls: [], external: [], unscripted: [], crossSite: [], console: [], release: async () => undefined };
  const held: Route[] = [];
  const turns = new Map<string, number>();
  page.on("console", (m) => site.console.push(`${m.type()} ${m.text()}`));
  page.on("pageerror", (e) => site.console.push(`pageerror ${e.message}`));
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
    if (url.pathname.startsWith("/api/site/")) return answer(site, o.script ?? {}, turns, held, route, request, url);
    return serveFile(route, url.pathname);
  });
  await page.goto(ORIGIN + path);
  await page.evaluate(() => document.fonts.ready);
  return site;
}

async function answer(site: FakeSite, script: Script, turns: Map<string, number>, held: Route[], route: Route, request: Request, url: URL): Promise<void> {
  const key = `${request.method()} ${url.pathname.slice("/api/site/".length)}`;
  const headers = await request.allHeaders();
  site.api.push({ method: request.method(), route: key, url: request.url(), body: request.postData(), headers });
  if (crossSite(request.method(), headers)) {
    site.crossSite.push(key);
    return route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"cross_site_request"}', headers: { "Cache-Control": "no-store" } });
  }
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

/**
 * The backend's cross-site rule (backend/src/player_backend/request_policy.py,
 * `cross_site_refusal`): a state change needs `Origin` equal to the site's origin, and a
 * `Sec-Fetch-Site` other than `same-origin` is refused. The fake applies it to every request.
 */
export function crossSite(method: string, headers: Readonly<Record<string, string>>): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) return false;
  if (headers["origin"] !== ORIGIN) return true;
  const fetchSite = headers["sec-fetch-site"];
  return fetchSite !== undefined && fetchSite !== "same-origin";
}

function serveFile(route: Route, pathname: string): Promise<void> {
  const rel = normalize(pathname).replace(/^[/\\]+/, "");
  // Every address of the site is the one page; its scripts, styles and fonts are files.
  const file = /^(site\.(js|css)|fonts\/[\w.-]+\.woff2)$/.test(rel) ? rel : "index.html";
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Content-Security-Policy": CSP, "Referrer-Policy": "no-referrer" },
    body: readFileSync(join(SITE_DIR, file)),
  });
}

/** What the instrumentation recorded in the page. */
export function traps(page: Page): Promise<{ kind: string; detail: string }[]> {
  return page.evaluate(() => (globalThis as unknown as { __traps: { kind: string; detail: string }[] }).__traps.slice());
}

/** Waits until the page has made `n` API requests and they were answered. */
export async function waitForApi(site: FakeSite, n: number): Promise<void> {
  for (let i = 0; i < 200 && site.api.length < n; i += 1) await site.page.waitForTimeout(10);
  if (site.api.length < n) throw new Error(`expected ${n} API requests, saw ${site.api.map((a) => a.route).join(", ")}`);
  await site.page.waitForTimeout(30);
}
