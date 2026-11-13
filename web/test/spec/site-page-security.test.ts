// What the website's pages may do in the browser (ADR 0002, sections 4 and 5; docs/design/site.md):
// one CSP with no inline script, no eval and no other origin; nothing kept in storage, cookies or
// logs; no Referer; the session left to the server's cookie; and the keyboard path through Sign in.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { DIST, WEB_DIR } from "../lib/browser.ts";
import { CSP, ORIGIN, crossSite, launchOffline, openSite, traps } from "../lib/site-fake.ts";
import { reach } from "../lib/site-measure.ts";
import { CHALLENGE_B64, LINK_TOKEN, STATES } from "../lib/site-states.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

describe("the page's CSP", () => {
  it("is the one the backend sends", () => {
    const policy = readFileSync(join(WEB_DIR, "..", "backend", "src", "player_backend", "request_policy.py"), "utf8");
    const m = /CONTENT_SECURITY_POLICY: Final = \(\s*"([^"]+)"\s*\)/.exec(policy);
    assert.ok(m, "the backend's CSP constant was not found");
    assert.equal(m[1], CSP, "the fake serves the backend's CSP");
    for (const bad of ["unsafe-", "data:", "blob:", "http:", "https:", "*"]) assert.ok(!CSP.includes(bad), bad);
  });

  it("is in the page too, and the page has no inline script, style or handler", () => {
    const html = readFileSync(join(DIST, "site", "index.html"), "utf8");
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
    assert.ok(meta, "no CSP meta");
    assert.match(meta[1], /^default-src 'self';/);
    assert.ok(!/unsafe-|https?:|\*/.test(meta[1]));
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) assert.match(tag, /\ssrc="\/[\w.]+"/, `inline script: ${tag}`);
    assert.doesNotMatch(html, /<script\b[^>]*>[^<]+<\/script>/);
    assert.doesNotMatch(html, /<style\b|\sstyle=|\son\w+=/i);
    assert.match(html, /<meta name="referrer" content="no-referrer">/);
  });

  it("is met by the bundle: no eval and no other origin", () => {
    const js = readFileSync(join(DIST, "site", "site.js"), "utf8");
    assert.doesNotMatch(js, /\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*["'`]/);
    assert.doesNotMatch(js, /https?:\/\/|wss?:\/\//);
    const css = readFileSync(join(DIST, "site", "site.css"), "utf8");
    assert.doesNotMatch(css, /url\(\s*["']?(https?:|\/\/)|@import/);
  });
});

describe("the fake's cross-site refusal (backend `cross_site_refusal`)", () => {
  // Page requests reach the fake without `Sec-Fetch-*` (Playwright does not show them), so this
  // table is where that half of the rule is exercised (#257).
  const same = { origin: ORIGIN };
  const cases: [string, Record<string, string>, boolean][] = [
    ["GET", {}, false],
    ["HEAD", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }, false],
    ["POST", same, false],
    ["POST", { ...same, "sec-fetch-site": "same-origin" }, false],
    ["POST", { ...same, "sec-fetch-site": "same-site" }, true],
    ["POST", { ...same, "sec-fetch-site": "cross-site" }, true],
    ["POST", { ...same, "sec-fetch-site": "none" }, true],
    ["post", { ...same, "sec-fetch-site": "cross-site" }, true],
    ["DELETE", { ...same, "sec-fetch-site": "same-site" }, true],
    ["PATCH", { ...same, "sec-fetch-site": "cross-site" }, true],
    ["PUT", { ...same, "sec-fetch-site": "cross-site" }, true],
    ["POST", {}, true],
    ["POST", { origin: "null" }, true],
    ["POST", { origin: "https://evil.example", "sec-fetch-site": "same-origin" }, true],
  ];
  for (const [method, headers, refused] of cases) {
    it(`${method} ${JSON.stringify(headers)} is ${refused ? "refused" : "let through"}`, () => {
      assert.equal(crossSite(method, headers), refused);
    });
  }
});

describe("nothing secret leaves the page, in any state", () => {
  for (const state of STATES) {
    it(state.name, async () => {
      const site = await reach(browser, { state, width: 390, zoom: 1, ink: false });
      const seen = await traps(site.page);
      // The session is the server's HttpOnly cookie: the page never reads or writes a cookie, and
      // keeps nothing in storage, IndexedDB or the cache.
      assert.deepEqual(seen.filter((t) => ["storage", "cookie", "indexeddb", "cache", "console", "csp"].includes(t.kind)), []);
      assert.deepEqual(site.console.filter((c) => !c.includes("Failed to load resource")), []);
      assert.deepEqual(site.external, [], "a request to another origin");
      assert.deepEqual(site.unscripted, [], "an API request the state does not expect");
      assert.deepEqual(site.crossSite, [], "an API request the backend refuses as cross-site");
      for (const a of site.api) {
        assert.equal(a.headers["referer"], undefined, `Referer on ${a.route}`);
        assert.equal(new URL(a.url).search, "", `a query on ${a.route}`);
        assert.ok(a.headers["content-type"] === undefined || a.headers["content-type"] === "application/json", a.route);
      }
      const secret = [LINK_TOKEN.slice(7), CHALLENGE_B64];
      for (const u of [site.page.url(), ...site.urls.slice(1)]) for (const s of secret) assert.ok(!u.includes(s), `secret in ${u}`);
      for (const t of seen) for (const s of secret) assert.ok(!t.detail.includes(s), `secret in ${t.kind}`);
      assert.equal(await site.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await site.context.close();
    });
  }
});

describe("the keyboard (site.md, S8)", () => {
  it("reaches the skip link first, which moves focus to the page without changing the address", async () => {
    const site = await openSite(browser, "/sign-in", { width: 390, height: 844 });
    await site.page.keyboard.press("Tab");
    assert.equal(await site.page.evaluate(() => document.activeElement?.className), "skip");
    await site.page.keyboard.press("Enter");
    assert.equal(await site.page.evaluate(() => document.activeElement?.id), "main");
    assert.equal(site.page.url(), `${ORIGIN}/sign-in`);
    await site.page.keyboard.press("Tab");
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name), "email");
    await site.context.close();
  });

  it("asks for a link with Enter in the field and signs in with a passkey from the keyboard", async () => {
    const site = await openSite(browser, "/sign-in", { width: 390, height: 844, script: { "POST sign-in/link": { status: 200, body: { status: "accepted" } } } });
    await site.page.focus("input[name=email]");
    await site.page.keyboard.type("ana@example.com");
    await site.page.keyboard.press("Enter");
    await site.page.waitForSelector(".note");
    assert.deepEqual(site.api.map((a) => a.route), ["POST sign-in/link"]);
    assert.equal(await site.page.evaluate(() => document.activeElement?.classList.contains("note")), true, "focus moves to the result");
    await site.context.close();
  });

  it("moves focus to the plate that explains a failure", async () => {
    const site = await openSite(browser, "/sign-in", { width: 390, height: 844, script: { "POST sign-in/link": { status: 503, body: { error: "unavailable" } } } });
    await site.page.fill("input[name=email]", "ana@example.com");
    await site.page.keyboard.press("Enter");
    await site.page.waitForSelector(".plate");
    assert.equal(await site.page.evaluate(() => document.activeElement?.classList.contains("plate")), true);
    await site.context.close();
  });
});
