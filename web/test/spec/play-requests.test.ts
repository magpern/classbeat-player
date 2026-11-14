// Guard (ADR 0008, section 6): the play page's fake test lists every request the page makes in each
// state, assets included, and compares them with the ADR:
//   - the page's own files;
//   - `GET /api/site/classes` (with `before` and `limit`);
//   - `GET /api/site/classes/{id}`;
//   - the site's sign-in and sign-out requests.
// While a class runs the list is empty: proved across a whole run with Start, Pause, Next, End, the
// keys and the end of the class. The page's headers are the site's: its CSP and
// `Referrer-Policy: no-referrer`.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { CLASS_ID, classScript, openPlay } from "../lib/play-fake.ts";
import { library, PICKER_STATES } from "../lib/play-picker-states.ts";
import { BASE_DOC, opened, rest, started, tapped, tickBy } from "../lib/play-states.ts";
import { CSP, launchOffline, ORIGIN, traps } from "../lib/site-fake.ts";
import type { FakeSite } from "../lib/site-fake.ts";

/** The page's own files: the page, its script, its three stylesheets and its four fonts. */
export const OWN_FILES = [
  "/play", "/play/play.js", "/play/base.css", "/play/page.css", "/play/room.css",
  "/play/fonts/atkinson-hyperlegible-latin-400-normal.woff2", "/play/fonts/atkinson-hyperlegible-latin-700-normal.woff2",
  "/play/fonts/big-shoulders-display-latin-600-normal.woff2", "/play/fonts/big-shoulders-display-latin-800-normal.woff2",
];
/** The two class routes, with the list's own query (`before`, `limit`), and the site's sign-in and sign-out. */
const CLASS_ROUTES = [/^\/api\/site\/classes\?(before=[^&]+&)?limit=\d+$/, /^\/api\/site\/classes\/[0-9a-f-]{36}$/];
const SITE_ROUTES = [/^\/api\/site\/sign-out$/, /^\/sign-in$/];

/** What the ADR allows the page to ask for, as a path and query. */
export function allowed(url: string): boolean {
  const u = new URL(url);
  const p = u.pathname + u.search;
  return u.origin === ORIGIN && (OWN_FILES.includes(p) || [...CLASS_ROUTES, ...SITE_ROUTES].some((r) => r.test(p)));
}

const requested = (site: FakeSite): string[] => site.urls.map((u) => u.replace(ORIGIN, ""));

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

describe("the requests of every state are the ADR's list", () => {
  for (const state of PICKER_STATES) {
    it(`${state.name}: only the page's files, the two class routes and the site's sign-in and sign-out`, async () => {
      const site = await openPlay(browser, { width: 390, height: 844, hash: state.path.slice("/play".length), script: state.script, clock: false });
      await state.steps?.(site.page);
      await site.page.waitForSelector(state.ready);
      await site.page.waitForTimeout(150);
      assert.deepEqual(requested(site).filter((u) => !allowed(ORIGIN + u)), [], "a request the ADR does not list");
      assert.deepEqual(site.external, []);
      assert.deepEqual(site.unscripted, []);
      assert.deepEqual(site.realms, [], "no frame, popup or worker");
      // The page's own files are each asked for once.
      assert.deepEqual(requested(site).filter((u) => OWN_FILES.includes(u)).filter((u, i, all) => all.indexOf(u) !== i), []);
      for (const must of ["/play", "/play/play.js", "/play/base.css", "/play/page.css", "/play/room.css"]) assert.ok(requested(site).includes(must), must);
      await site.context.close();
    });
  }

  it("the picker reads GET classes with limit, and each page after it with before", async () => {
    const page1 = { status: 200, body: { classes: library(2), cursor: "abc123", more: true } };
    const page2 = { status: 200, body: { classes: library(3).slice(2), cursor: null, more: false } };
    const site = await openPlay(browser, { width: 390, height: 844, script: { "GET classes": [page1, page2] }, clock: false });
    await site.page.waitForSelector(".rows .row");
    assert.deepEqual(site.api.map((a) => a.url.replace(ORIGIN, "")), ["/api/site/classes?limit=200", "/api/site/classes?before=abc123&limit=200"]);
    assert.equal(await site.page.locator(".rows .row").count(), 3);
    await site.context.close();
  });

  it("the class is read once, by its id from the fragment, and the id is in no request line", async () => {
    const site = await openPlay(browser, { width: 390, height: 844, hash: `#${CLASS_ID}`, script: classScript(BASE_DOC) });
    await opened(site.page);
    assert.deepEqual(site.api.map((a) => a.route), [`GET classes/${CLASS_ID}`]);
    assert.ok(!requested(site).some((u) => u.includes("#")), "a fragment is never sent");
    assert.equal(site.api[0].headers["referer"], undefined, "no referrer");
    await site.context.close();
  });
});

/** Run in the page ahead of its own: notes the state of every face at the moment the room first enters the page. */
const FACES_AT_ROOM = `window.__facesAtRoom = null;
new MutationObserver(() => {
  if (window.__facesAtRoom === null && document.querySelector(".room")) window.__facesAtRoom = [...document.fonts].map((f) => f.family.replace(/"/g, "") + " " + f.weight + " " + f.status);
}).observe(document, { childList: true, subtree: true });`;
const FONT_FILES = OWN_FILES.filter((f) => f.endsWith(".woff2"));

describe("every asset is in before Start", () => {
  it("all four font files are asked for before Start, and every face is loaded when the room first enters the page", async () => {
    const site = await openPlay(browser, { width: 390, height: 844, hash: `#${CLASS_ID}`, script: classScript(BASE_DOC), before: FACES_AT_ROOM });
    await opened(site.page);
    assert.equal(FONT_FILES.length, 4);
    for (const f of FONT_FILES) assert.ok(requested(site).includes(f), `${f} is not asked for before Start`);
    // A face is only fetched when text first needs it, so what proves the page asked for them all is
    // that none was still unloaded when the room appeared (the first draw is what would ask).
    const faces = await site.page.evaluate(() => (window as unknown as { __facesAtRoom: string[] | null }).__facesAtRoom);
    assert.ok(faces !== null, "the room was never seen entering the page");
    const ours = faces.filter((f) => /^(Big Shoulders Display|Atkinson Hyperlegible) /.test(f));
    assert.equal(ours.length, 4, ours.join(", "));
    assert.deepEqual(ours.filter((f) => !f.endsWith(" loaded")), [], "a face not yet loaded when the room appeared");
    await site.context.close();
  });
});

describe("while a class runs the list of requests is empty", () => {
  it("across a run with Start, Pause, Resume, Next, Previous, the 5 s jumps, the band, End, Keep going and the end of the class", async () => {
    const site = await openPlay(browser, { width: 390, height: 844, hash: `#${CLASS_ID}`, script: classScript(BASE_DOC) });
    await opened(site.page);
    await rest(site.page);
    // Every asset is in before Start: nothing is on its way.
    const mark = { urls: site.urls.length, api: site.api.length };
    const page = site.page;
    const quiet = (step: string): void => {
      assert.deepEqual(site.urls.slice(mark.urls), [], `a request after ${step}`);
      assert.equal(site.api.length, mark.api, `an API call after ${step}`);
    };
    await started(page);
    quiet("Start");
    await page.keyboard.press("Space");
    await tickBy(page, 200);
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageUp");
    await tickBy(page, 4000);
    quiet("Pause, Resume, Next, Previous and the jumps");
    await tapped(page, [390, 844]);
    await page.click('[data-action="pause"]');
    await page.click('[data-action="resume"]');
    await page.click('[data-action="next"]');
    await page.click('[data-action="previous"]');
    await page.click('[data-action="end"]');
    await page.click('[data-action="keep-going"]');
    await tickBy(page, 8100);
    quiet("the band's buttons, End and Keep going");
    await page.keyboard.press("End");
    await tickBy(page, 8500);
    quiet("the End question that answers itself");
    await page.clock.fastForward(BASE_DOC.class.length_ms);
    await tickBy(page, 500);
    await page.waitForSelector('[data-action="close"]');
    quiet("the end of the class");
    // Class Complete is not the end of the page: Close class is the first request since Start.
    await page.click('[data-action="close"]');
    await page.waitForSelector(".rows .row, .btns a, .plate");
    assert.deepEqual(site.api.slice(mark.api).map((a) => a.route), ["GET classes"], "the picker is the first request since Start");
    assert.equal(new URL(page.url()).hash, "", "the fragment is cleared");
    assert.equal(new URL(page.url()).pathname, "/play");
    assert.deepEqual(requested(site).filter((u) => !allowed(ORIGIN + u)), []);
    await site.context.close();
  });

  it("End class takes the same way: the picker is the first request since Start, and no file is asked for again", async () => {
    const list = { status: 200, body: { classes: library(2), cursor: null, more: false } };
    const site = await openPlay(browser, { width: 844, height: 390, hash: `#${CLASS_ID}`, script: { ...classScript(BASE_DOC), "GET classes": list } });
    await started(site.page);
    const mark = { urls: site.urls.length, api: site.api.length };
    await site.page.keyboard.press("End");
    await site.page.click('[data-action="end-class"]');
    await site.page.waitForSelector(".rows .row");
    assert.deepEqual(site.api.slice(mark.api).map((a) => a.route), ["GET classes"]);
    assert.deepEqual(site.urls.slice(mark.urls).map((u) => u.replace(ORIGIN, "")), ["/api/site/classes?limit=200"]);
    await site.context.close();
  });

  it("a lost connection during a class changes nothing on the screen", async () => {
    const site = await openPlay(browser, { width: 390, height: 844, hash: `#${CLASS_ID}`, script: classScript(BASE_DOC) });
    await started(site.page);
    const before = await site.page.locator(".rail .link").textContent();
    await site.context.setOffline(true);
    await site.page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await tickBy(site.page, 5000);
    assert.equal(await site.page.locator(".rail .link").textContent(), before);
    assert.equal(await site.page.locator(".count").count(), 1);
    await site.context.setOffline(false);
    await site.context.close();
  });
});

describe("the page's headers and what it keeps", () => {
  it("every file of the page is served with the site's CSP and Referrer-Policy: no-referrer, and the page carries both in its head", async () => {
    const site = await openPlay(browser, { width: 390, height: 844, hash: `#${CLASS_ID}`, script: classScript(BASE_DOC), clock: false });
    const seen: Record<string, Record<string, string>> = {};
    site.page.on("response", (r) => {
      seen[new URL(r.url()).pathname] = r.headers();
    });
    const doc = await site.page.reload();
    await opened(site.page);
    assert.equal(doc?.headers()["content-security-policy"], CSP);
    assert.equal(doc?.headers()["referrer-policy"], "no-referrer");
    for (const f of OWN_FILES.filter((x) => x !== "/play")) {
      if (!seen[f]) continue;
      assert.equal(seen[f]["content-security-policy"], CSP, f);
      assert.equal(seen[f]["referrer-policy"], "no-referrer", f);
    }
    const head = await site.page.evaluate(() => ({
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
      referrer: document.querySelector('meta[name="referrer"]')?.getAttribute("content"),
      inline: [...document.querySelectorAll("script:not([src])")].length,
      styles: [...document.querySelectorAll("style")].length,
    }));
    assert.equal(head.csp, "default-src 'self'; base-uri 'none'; form-action 'self'");
    assert.equal(head.referrer, "no-referrer");
    assert.deepEqual([head.inline, head.styles], [0, 0], "no inline script and no style element (the score is set through the CSSOM, which the CSP allows)");
    assert.deepEqual((await traps(site.page)).filter((t) => t.kind === "csp"), [], "no CSP violation");
    await site.context.close();
  });

  it("nothing is written to the browser: no storage, cookie, IndexedDB or cache, across a class", async () => {
    const site = await openPlay(browser, { width: 390, height: 844, hash: `#${CLASS_ID}`, script: classScript(BASE_DOC) });
    await started(site.page);
    await site.page.keyboard.press("End");
    await site.page.keyboard.press("Escape");
    await site.page.clock.fastForward(BASE_DOC.class.length_ms);
    await tickBy(site.page, 500);
    const kinds = (await traps(site.page)).map((t) => t.kind);
    assert.deepEqual(kinds.filter((k) => ["storage", "cookie", "indexeddb", "cache", "markup", "script", "missing"].includes(k)), []);
    assert.deepEqual(await site.page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie]), [0, 0, ""]);
    assert.deepEqual(site.realms, [], "no service worker, worker, frame or popup");
    await site.context.close();
  });
});
