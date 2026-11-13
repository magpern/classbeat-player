// The companion fake serves /control with the headers the backend sets (backend/src/player_backend/
// control_page_policy.py). The Python file is read as text and compared, as the site CSP test does
// for request_policy.py, so the fake cannot drift from the backend.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { WEB_DIR } from "../lib/browser.ts";
import { ORIGIN, controlCsp, controlHeaders } from "../lib/companion-fake.ts";

const SOURCE = readFileSync(join(WEB_DIR, "..", "backend", "src", "player_backend", "control_page_policy.py"), "utf8");
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
    const page = controlHeaders("/control");
    assert.deepEqual(Object.keys(page).sort(), [...Object.keys(fixed), "Cache-Control", "Content-Security-Policy"].sort());
    for (const [k, v] of Object.entries(fixed)) assert.equal(page[k], v, k);
    assert.equal(page["Cache-Control"], "no-store");
    for (const p of ["/control/companion.js", "/control/companion.css", "/control/fonts/ui.woff2"]) assert.equal(controlHeaders(p)["Cache-Control"], "no-cache", p);
    for (const p of ["/control/", "/control/index.html", "/control/companion.js.map", "/control/a/b/c.js", "/control/Upper.js"]) assert.equal(controlHeaders(p)["Cache-Control"], "no-store", p);
  });
});
