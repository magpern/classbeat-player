// The site's own files on the fake (site-fake.ts): every address of the site is the one page, its
// scripts, styles and fonts are files from dist/site/, the companion stands in as a plain page and
// the web player page (ADR 0008) is served beside it, each with the backend's page headers.
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import type { Route } from "playwright-core";
import { DIST } from "./browser.ts";

const SITE_DIR = join(DIST, "site");
const TYPES: Readonly<Record<string, string>> = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".html": "text/html; charset=utf-8" };
const CSP_HEADER = "Content-Security-Policy";

/**
 * A response's headers with the page's CSP set once, under one name. Header names are not case
 * sensitive, so a header in `headers` named Content-Security-Policy in any case would replace the
 * policy or add a second one: it is refused, and the fake fails loudly instead (#422 N5).
 */
export function withCsp(csp: string, headers: Readonly<Record<string, string>> = {}): Record<string, string> {
  for (const name of Object.keys(headers)) if (name.toLowerCase() === CSP_HEADER.toLowerCase()) throw new Error(`a reply may not set the page's CSP (${name})`);
  return { ...headers, [CSP_HEADER]: csp };
}

/** A file of the site, the companion's stand-in or the play page, with the page headers. */
export function serveFile(route: Route, pathname: string, csp: string): Promise<void> {
  const rel = normalize(pathname).replace(/^[/\\]+/, "");
  // The companion page (served beside the site at /control) stands in as a plain page.
  if (rel === "control") return route.fulfill({ status: 200, headers: withCsp(csp, { "Content-Type": TYPES[".html"], "Referrer-Policy": "no-referrer" }), body: "<!doctype html><title>Companion</title>" });
  // The web player page (ADR 0008) is built beside the site and served at /play: its page, and its own files.
  if (rel === "play" || rel.startsWith("play/")) return servePlay(route, rel, csp);
  // Every address of the site is the one page; its scripts, styles and fonts are files.
  const file = /^(site\.(js|css)|fonts\/[\w.-]+\.woff2)$/.test(rel) ? rel : "index.html";
  return route.fulfill({
    status: 200,
    headers: withCsp(csp, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Referrer-Policy": "no-referrer" }),
    body: readFileSync(join(SITE_DIR, file)),
  });
}

/** The files of the play page that are served beside it: its script, its three stylesheets and its fonts. */
export const PLAY_FILE = /^play\/(play\.js|(?:base|page|room)\.css|fonts\/[\w.-]+\.woff2)$/;

/** `/play` (and `/play/`) is the page; each of its own files is served with the site's headers; anything else under /play is not found. */
function servePlay(route: Route, rel: string, csp: string): Promise<void> {
  const headers = withCsp(csp, { "Referrer-Policy": "no-referrer" });
  const file = rel === "play" || rel === "play/" ? "index.html" : PLAY_FILE.test(rel) ? rel.slice("play/".length) : null;
  if (file === null) return route.fulfill({ status: 404, headers, body: "" });
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", ...headers },
    body: readFileSync(join(SITE_DIR, "play", file)),
  });
}
