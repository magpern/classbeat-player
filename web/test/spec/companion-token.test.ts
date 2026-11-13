// The companion page's token handling (ADR 0005 sections 3 and 8; docs/design/companion.md, "Page
// hardening"), on the fake site: both ways in, the fragment taken away before anything else runs,
// the token only in sessionStorage and the one `hello`, never in an address, a query, a log or a
// referrer, and the page under the backend's content security policy.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { ERROR_NAMES } from "../../src/companion/core/answer.ts";
import { ERROR_WORDS, WORDS } from "../../src/companion/core/entry.ts";
import { PAGE_URL, launchOffline, openCompanion } from "../lib/companion-fake.ts";
import type { Fake, Reply } from "../lib/companion-fake.ts";
import { SECRET43, examples } from "../lib/live-examples.ts";

const TOKEN = `cbp_ctl_${SECRET43}`;
const OK: Reply = { status: 200, body: { controllerToken: TOKEN } };
const [STATE] = examples("companion-state", "valid").filter((e) => e.name.endsWith("following-locked.json")).map((e) => e.value);

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const size = { width: 390, height: 844 };

/** Where the token may be: only the hello frame and sessionStorage. */
async function assertTokenContained(f: Fake): Promise<void> {
  const traps = await f.traps();
  assert.equal(f.page.url(), PAGE_URL, "no fragment or query left in the address");
  for (const s of f.api) {
    assert.doesNotMatch(s.url, /\?/, "no query");
    assert.ok(!s.url.includes(TOKEN));
    assert.equal(s.headers.referer, undefined, "no referrer");
  }
  for (const u of f.live.urls) {
    assert.equal(u, "wss://site.test/api/live/ws", "no query, no token in the socket's address");
  }
  const withToken = f.live.sent.filter((t) => t.includes(TOKEN));
  for (const t of withToken) assert.deepEqual(JSON.parse(t), { v: 1, type: "hello", token: TOKEN });
  for (const t of traps) {
    if (t.kind === "storage" && t.detail.includes(TOKEN)) assert.equal(t.detail, `session setItem classbeat.companion.controller ${TOKEN}`);
    else assert.ok(!t.detail.includes(TOKEN), `${t.kind}: ${t.detail}`);
  }
  assert.ok(!traps.some((t) => t.kind === "storage" && t.detail.startsWith("local")), "never localStorage");
  assert.ok(!traps.some((t) => t.kind === "cookie"), "never a cookie");
  assert.deepEqual(traps.filter((t) => ["console", "csp", "error"].includes(t.kind)), [], "no log, no CSP violation, no error");
  assert.deepEqual(f.external, []);
  // The page's text, attributes and field values (no markup is read or written).
  const body = await f.page.evaluate(() => [...document.querySelectorAll("*")].flatMap((n) => [n.textContent ?? "", n instanceof HTMLInputElement ? n.value : "", ...[...n.attributes].map((a) => a.value)]).join("\n"));
  assert.ok(!body.includes(TOKEN), "not in the page");
}

const firstIndex = (traps: { kind: string }[], kind: string): number => traps.findIndex((t) => t.kind === kind);

describe("companion token: by control code (the QR code)", () => {
  it("strips the fragment first, sends both codes at once, and keeps the token to sessionStorage and hello", async () => {
    const f = await openCompanion(browser, { ...size, hash: "#BCDF-GHJK.LMNP-QRST", answers: { control: [OK] } });
    await f.page.waitForSelector("text=Connecting to the class");
    f.live.send(STATE);
    await f.page.waitForSelector(".run .gel-num");
    const traps = await f.traps();
    const h = firstIndex(traps, "history");
    assert.equal(traps[h].detail, `replaceState /control from ${PAGE_URL}#BCDF-GHJK.LMNP-QRST`);
    // The socket opens only after the POST's answer, so after the fragment is gone too.
    for (const k of ["fetch", "storage"]) assert.ok(firstIndex(traps, k) > h, `${k} after the fragment is gone`);
    for (const t of traps.filter((x) => x.kind === "fetch")) assert.doesNotMatch(t.detail, /#|\?/, t.detail);
    const post = f.api.find((s) => s.method === "POST");
    assert.equal(post?.url, "https://site.test/api/live/control");
    assert.deepEqual(JSON.parse(post?.body ?? ""), { session: "BCDF-GHJK", code: "LMNP-QRST" });
    assert.equal(post?.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(f.live.sent[0]), { v: 1, type: "hello", token: TOKEN });
    await assertTokenContained(f);
    await f.context.close();
  });

  it("a reload connects with the token from sessionStorage, and nothing else", async () => {
    const f = await openCompanion(browser, { ...size, stored: TOKEN });
    await f.page.waitForSelector("text=Connecting to the class");
    assert.deepEqual(f.live.sent.map((t) => JSON.parse(t)), [{ v: 1, type: "hello", token: TOKEN }]);
    assert.equal(f.api.filter((s) => s.method === "POST").length, 0);
    await f.context.close();
  });

  it("#<join> alone only fills the class code; nothing is sent (rule 14)", async () => {
    const f = await openCompanion(browser, { ...size, hash: "#bcdf-ghjk" });
    await f.page.waitForSelector("text=Sign in to steer");
    assert.equal(await f.page.inputValue("#class-code"), "BCDF-GHJK");
    assert.equal(f.page.url(), PAGE_URL);
    assert.equal(f.api.filter((s) => s.method === "POST").length, 0);
    assert.equal(f.live.urls.length, 0);
    await f.context.close();
  });

  it("every error name of the contract shows its words, and nothing is stored", async () => {
    const replies: Reply[] = ERROR_NAMES.map((error): Reply => ({ status: error === "too_many_requests" ? 429 : 403, body: { error }, headers: error === "too_many_requests" ? { "retry-after": "60" } : {} }));
    const f = await openCompanion(browser, { ...size, hash: "#BCDF-GHJK", answers: { control: [...replies, { status: 0, fail: true }] } });
    await f.page.fill("#control-code", "lmnpqrst");
    for (const error of [...ERROR_NAMES, "offline"] as const) {
      await f.page.click("[data-action=control]");
      if (error === "controllers_full") {
        await f.page.waitForSelector("text=Two phones already steer this class");
        assert.equal(await f.page.inputValue("#control-code"), "", "the used code is cleared");
        assert.equal(await f.page.inputValue("#class-code"), "BCDF-GHJK");
        await f.page.fill("#control-code", "lmnpqrst");
        continue;
      }
      const words = error === "offline" ? WORDS.unreachable : ERROR_WORDS[error];
      await f.page.waitForFunction((w) => document.querySelector("#control-code-error")?.textContent === w, words);
    }
    const traps = await f.traps();
    assert.ok(!traps.some((t) => t.kind === "storage" && t.detail.includes("setItem")));
    assert.equal(f.live.urls.length, 0);
    await f.context.close();
  });
});

describe("companion token: by sign-in", () => {
  it("not signed in: Sign in to steer opens the site's sign-in page and sends nothing", async () => {
    const f = await openCompanion(browser, { ...size, hash: "#BCDF-GHJK" });
    await f.page.click("[data-action=sign_in]");
    await f.page.waitForURL("https://site.test/sign-in");
    assert.equal(f.api.filter((s) => s.method === "POST").length, 0);
    await f.context.close();
  });

  it("signed in: the class code goes to /api/live/controller, then the socket", async () => {
    const f = await openCompanion(browser, { ...size, hash: "#BCDF-GHJK", signedIn: true, answers: { controller: [{ status: 403, body: { error: "cannot_control" } }, OK] } });
    await f.page.waitForSelector("text=Steer this class");
    await f.page.click("[data-action=control]");
    await f.page.waitForFunction((w) => document.querySelector("#class-code-error")?.textContent === w, WORDS.signInWrong);
    await f.page.click("[data-action=control]");
    await f.page.waitForSelector("text=Connecting to the class");
    const posts = f.api.filter((s) => s.method === "POST");
    assert.deepEqual(posts.map((s) => [s.url, JSON.parse(s.body ?? "")]), [
      ["https://site.test/api/live/controller", { session: "BCDF-GHJK" }],
      ["https://site.test/api/live/controller", { session: "BCDF-GHJK" }],
    ]);
    assert.equal(posts[0].headers.origin, "https://site.test", "same origin, as the backend requires");
    await assertTokenContained(f);
    await f.context.close();
  });
});

describe("companion token: when control ends", () => {
  for (const [how, act] of [
    ["ended dropped", (f: Fake) => f.live.send({ v: 1, type: "ended", reason: "dropped" })],
    ["ended revoked", (f: Fake) => f.live.send({ v: 1, type: "ended", reason: "revoked" })],
    ["hello refused (4401)", (f: Fake) => f.live.close(4401)],
    ["replaced (4409)", (f: Fake) => f.live.close(4409)],
  ] as const) {
    it(`${how}: the token is forgotten and no new connection is tried`, async () => {
      const f = await openCompanion(browser, { ...size, stored: TOKEN });
      await f.page.waitForSelector("text=Connecting to the class");
      f.live.send(STATE);
      await f.page.waitForSelector(".run");
      await act(f);
      await f.page.waitForSelector(how === "ended dropped" ? "text=This phone no longer steers the class" : "text=The class session has ended");
      const traps = await f.traps();
      assert.ok(traps.some((t) => t.detail === "session removeItem classbeat.companion.controller"));
      assert.equal(await f.page.evaluate(() => sessionStorage.getItem("classbeat.companion.controller")), null);
      await f.page.waitForTimeout(1500);
      assert.equal(f.live.urls.length, 1);
      await f.context.close();
    });
  }
});
