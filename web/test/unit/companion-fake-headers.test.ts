// The companion fake serves /control with the headers the backend sets (backend/src/player_backend/
// control_page_policy.py). The Python file is read as text and compared, as the site CSP test does
// for request_policy.py, so the fake cannot drift from the backend.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ORIGIN, controlCsp, controlHeaders } from "../lib/companion-fake.ts";
import { POLICY_SOURCE, isAssetPathBy, parseAssetRule } from "../lib/control-rule.ts";

const SOURCE = readFileSync(POLICY_SOURCE, "utf8");
const strings = (text: string): string[] => [...text.matchAll(/f?"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
const body = (name: string): string => {
  const m = new RegExp(`def ${name}\\([^]*?(?=\\n(?:def |\\S)|$)`).exec(SOURCE.slice(SOURCE.indexOf(`def ${name}`)));
  assert.ok(m, `${name} not found in the backend`);
  return m[0];
};

describe("the companion fake's /control headers", () => {
  it("has the backend's content security policy", () => {
    const fetched = /_FETCHED: Final = \(([^)]*)\)/.exec(SOURCE);
    const ws = /_LIVE_WS: Final = "([^"]+)"/.exec(SOURCE);
    assert.ok(fetched && ws, "the backend's connect paths were not found");
    const ret = /return \(([^]*?)\n {4}\)/.exec(body("content_security_policy"));
    assert.ok(ret, "the backend's policy was not found");
    const origin = "https://site.example";
    const connect = [...strings(fetched[1]).map((p) => origin + p), "wss://site.example" + ws[1]].join(" ");
    const expected = strings(ret[1]).join("").replace("{connect}", connect);
    assert.equal(controlCsp(origin), expected);
    // Only this text comparison covers the wss entry: the browser tests cannot, because Playwright's
    // routeWebSocket replaces WebSocket in the page and a CSP never sees the socket.
    assert.equal(controlCsp(ORIGIN), expected.replaceAll("site.example", "site.test"));
    for (const bad of ["unsafe-", "data:", "blob:", "http:", "*"]) assert.ok(!expected.includes(bad), bad);
  });

  it("has the backend's other headers, with no-store on the page and no-cache on built files", () => {
    const ret = /return \{([^]*?)\n {4}\}/.exec(body("control_headers"));
    assert.ok(ret, "the backend's headers were not found");
    const pairs = [...(ret[1] + "\n").matchAll(/"([\w-]+)": ([^\n]+?),?\n/g)].map((m) => [m[1], m[2]] as const);
    const fixed = Object.fromEntries(pairs.filter(([, v]) => /^"[^"]*"$/.test(v)).map(([k, v]) => [k, v.slice(1, -1)]));
    const cache = pairs.find(([k]) => k === "Cache-Control")?.[1] ?? "";
    assert.equal(strings(cache).join("|"), "no-cache|no-store", "the backend's cache rule changed");
    assert.deepEqual(Object.keys(fixed).sort(), ["Referrer-Policy", "X-Content-Type-Options", "X-Frame-Options"]);
    // Every header's key and value, in full, for each kind of path.
    const csp = controlCsp(ORIGIN);
    const expected = (cacheControl: string): Record<string, string> => ({ ...fixed, "Content-Security-Policy": csp, "Cache-Control": cacheControl });
    assert.deepEqual(controlHeaders("/control"), expected("no-store"));
    for (const p of ["/control/companion.js", "/control/companion.css", "/control/fonts/ui.woff2"]) assert.deepEqual(controlHeaders(p), expected("no-cache"), p);
    for (const p of ["/control/", "/control/index.html", "/control/companion.js.map", "/control/a/b/c.js", "/control/Upper.js"]) assert.deepEqual(controlHeaders(p), expected("no-store"), p);
  });

  it("agrees with the backend's is_asset_path on a table of paths", () => {
    // Expected values follow control_page_policy.is_asset_path / asset_type by hand.
    const table: ReadonlyArray<readonly [string, boolean]> = [
      ["/control/companion.js", true],
      ["/control/companion.css", true],
      ["/control/fonts/ui.woff2", true],
      ["/control/a/b/c.js", false], // deeper than MAX_DEPTH
      ["/control/Upper.js", false], // upper case is not a segment
      ["/control/companion.js.map", false],
      ["/control/index.html", false],
      ["/control/", false],
      ["/control", false],
      ["/controls/a.js", false],
      ["/control/.js", false], // no name before the dot
      ["/control/noext", false],
      ["/control/fonts//ui.woff2", false], // empty segment
      ["/control/../x.js", false],
      ["/control/a b.js", false],
      ["/other/a.js", false],
    ];
    const rule = parseAssetRule(SOURCE);
    for (const [path, expected] of table) assert.equal(isAssetPathBy(rule, path), expected, path);
  });

  it("reads a single-quoted asset type key and fails loudly on one it cannot read", () => {
    assert.deepEqual([...parseAssetRule(SOURCE.replace('".css":', "'.css':")).extensions].sort(), [".css", ".js", ".woff2"]);
    assert.throws(() => parseAssetRule(SOURCE.replace('".css":', "(1):")), /not found/);
  });

  it("reads the asset rule from the backend file", () => {
    const rule = parseAssetRule(SOURCE);
    assert.deepEqual([...rule.extensions].sort(), [".css", ".js", ".woff2"]);
    assert.equal(rule.maxDepth, 2);
    assert.ok(isAssetPathBy(rule, "/control/fonts/ui.woff2"));
    assert.ok(!isAssetPathBy(rule, "/control/a/b/c.js"));
    // A change to the backend's rule changes what the fake does.
    const deeper = parseAssetRule(SOURCE.replace("MAX_DEPTH: Final = 2", "MAX_DEPTH: Final = 3"));
    assert.ok(isAssetPathBy(deeper, "/control/a/b/c.js"));
    const more = parseAssetRule(SOURCE.replace('".woff2": "font/woff2",', '".woff2": "font/woff2",\n    ".svg": "image/svg+xml",'));
    assert.ok(isAssetPathBy(more, "/control/logo.svg"));
    const upper = parseAssetRule(SOURCE.replace("[a-z0-9][a-z0-9_-]*", "[A-Za-z0-9][A-Za-z0-9_-]*"));
    assert.ok(isAssetPathBy(upper, "/control/Upper.js"));
    assert.throws(() => parseAssetRule(SOURCE.replace("MAX_DEPTH", "MAX_LEVELS")), /not found/);
  });
});
