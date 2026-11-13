// Sign-in on the fake backend (ADR 0002, section 4; docs/design/site.md, "Sign in"): the same
// answer for every address, the link token's path through the page, the passkey exchange, the
// way back after a sign-in and signing out.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { DIST } from "../lib/browser.ts";
import { ORIGIN, launchOffline, openSite, traps, waitForApi } from "../lib/site-fake.ts";
import { heapHolds } from "../lib/site-heap.ts";
import type { FakeSite, OpenOptions } from "../lib/site-fake.ts";
import { LINK_TOKEN, PASSKEY_OPTIONS } from "../lib/site-states.ts";

const SIZE = { width: 390, height: 844 } as const;
const CLASSES = { "GET classes": { status: 200, body: { classes: [], next: null } } } as const;
const PASSKEY_OK = { "POST sign-in/passkey/options": { status: 200, body: PASSKEY_OPTIONS }, "POST sign-in/passkey": { status: 200, body: { status: "signed_in" } } } as const;

let browser: Browser;
const open = (path: string, o: Partial<OpenOptions> = {}): Promise<FakeSite> => openSite(browser, path, { ...SIZE, ...o });
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).click();
const mainHtml = (page: Page): Promise<string> => page.evaluate(() => { const m = document.querySelector("main"); return m ? new XMLSerializer().serializeToString(m) : ""; });
const path = (page: Page): string => page.url().slice(ORIGIN.length);

before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

describe("the same answer for every address (ADR 0002, section 4)", () => {
  // The backend answers 202-style "accepted" whether or not the address may sign in. The page must
  // not be able to tell them apart either: it shows the same thing for any successful answer.
  const paths = [
    { email: "allowed@example.com", body: { status: "accepted" } },
    { email: "not-allowed@example.org", body: { status: "accepted" } },
    // A body the backend never sends: the page still does not read it.
    { email: "other@example.net", body: { status: "accepted", allowed: false, error: "not_allowed" } },
  ];

  it("shows one page, focus and title for an allowed and a not-allowed address", async () => {
    const seen: { html: string; title: string; focus: string; requests: string[] }[] = [];
    for (const x of paths) {
      const site = await open("/sign-in", { script: { "POST sign-in/link": { status: 200, body: x.body } } });
      await site.page.fill("input[name=email]", x.email);
      await press(site.page, "Email me a sign-in link");
      await site.page.waitForSelector(".note");
      seen.push({
        html: (await mainHtml(site.page)).replaceAll(x.email, "ADDRESS"),
        title: await site.page.title(),
        focus: await site.page.evaluate(() => document.activeElement?.className ?? ""),
        requests: site.api.map((a) => `${a.route} ${a.body?.replace(x.email, "ADDRESS")}`),
      });
      assert.ok((await mainHtml(site.page)).includes(x.email), "the sent page names the address typed");
      await site.context.close();
    }
    assert.deepEqual(seen[1], seen[0]);
    assert.deepEqual(seen[2], seen[0]);
    assert.deepEqual(seen[0].requests, ['POST sign-in/link {"email":"ADDRESS"}']);
  });

  it("has no wording anywhere in the page that says an address may not sign in", () => {
    const bundle = readFileSync(join(DIST, "site", "site.js"), "utf8");
    for (const words of [/not allowed/i, /no account/i, /not registered/i, /unknown (email|address)/i, /not on the (list|allow)/i, /isn.t (allowed|invited)/i, /we (don.t|do not) know/i]) {
      assert.doesNotMatch(bundle, words);
    }
  });
});

describe("the link token (ADR 0002, section 4, steps 5 and 6)", () => {
  it("leaves the address at once, is sent only in one POST body, and is never kept", async () => {
    const site = await open(`/sign-in#${LINK_TOKEN}`, { script: { "POST sign-in/complete": { status: 200, body: { status: "signed_in" } }, ...CLASSES } });
    await site.page.waitForSelector(".btn.primary:focus");
    assert.equal(site.page.url(), `${ORIGIN}/sign-in`);
    assert.equal(site.api.length, 0, "opening the link signs in only when the person presses Sign in");
    const history = (await traps(site.page)).filter((x) => x.kind === "history");
    assert.deepEqual(history.map((x) => x.detail), ["replaceState /sign-in"]);
    assert.ok(!(await site.page.content()).includes(LINK_TOKEN), "the token is not in the page");
    await press(site.page, "Sign in");
    await site.page.waitForSelector("nav .a.cur");
    assert.equal(path(site.page), "/classes");
    const complete = site.api.filter((a) => a.route === "POST sign-in/complete");
    assert.equal(complete.length, 1);
    assert.deepEqual(JSON.parse(complete[0].body ?? ""), { token: LINK_TOKEN });
    assert.equal(complete[0].headers["referer"], undefined);
    for (const u of site.urls) assert.ok(!u.includes(LINK_TOKEN.slice(7)), `token in a request URL: ${u}`);
    for (const t of await traps(site.page)) assert.ok(!t.detail.includes(LINK_TOKEN.slice(7)), `token in ${t.kind}`);
    assert.deepEqual((await traps(site.page)).filter((x) => x.kind !== "history"), []);
    await site.context.close();
  });

  it("is dropped when refused: the link cannot be sent again", async () => {
    const site = await open(`/sign-in#${LINK_TOKEN}`, { script: { "POST sign-in/complete": { status: 401, body: { error: "sign_in_refused" } } } });
    await site.page.waitForSelector(".btn.primary:focus");
    // The heap search finds the token while the page holds it, so its absence below is a drop.
    assert.equal(await heapHolds(site.page, LINK_TOKEN.slice(7)), true, "the page holds the token before it is used");
    await press(site.page, "Sign in");
    await site.page.waitForSelector(".plate");
    assert.match(await site.page.innerText(".plate"), /This link cannot be used/);
    assert.equal(await site.page.getByRole("button", { name: "Sign in", exact: true }).count(), 0);
    assert.equal(site.api.length, 1);
    assert.equal(await heapHolds(site.page, LINK_TOKEN.slice(7)), false, "the refused token is still held by the page");
    await site.context.close();
  });

  it("shows a broken link as refused without asking the backend", async () => {
    const site = await open(`/sign-in#${LINK_TOKEN.slice(0, 20)}`);
    await site.page.waitForSelector(".plate");
    assert.equal(site.page.url(), `${ORIGIN}/sign-in`);
    assert.deepEqual(site.api, []);
    await site.context.close();
  });

  it("drops a query sent to the sign-in page", async () => {
    const site = await open(`/sign-in?token=${LINK_TOKEN}&next=//evil.example`);
    assert.equal(site.page.url(), `${ORIGIN}/sign-in`);
    await site.context.close();
  });
});

describe("a passkey (ADR 0002, section 4)", () => {
  it("passes the backend's challenge through, lists no credentials and sends the assertion", async () => {
    const site = await open("/sign-in", { script: { ...PASSKEY_OK, ...CLASSES } });
    await press(site.page, "Sign in with a passkey");
    await site.page.waitForSelector("nav .a.cur");
    assert.deepEqual(site.api.map((a) => a.route), ["POST sign-in/passkey/options", "POST sign-in/passkey", "GET classes"]);
    assert.equal(site.api[0].body, null, "the options request takes no email");
    const get = (await traps(site.page)).filter((x) => x.kind === "passkey");
    assert.deepEqual(get.map((x) => x.detail), [`get challenge=${Array.from({ length: 32 }, (_, i) => i).join(",")} allow=0 uv=required rp=site.test`]);
    assert.deepEqual(JSON.parse(site.api[1].body ?? ""), {
      credential: {
        id: "Y3JlZC0x",
        rawId: "Y3JlZC0x",
        type: "public-key",
        authenticatorAttachment: "platform",
        response: { clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0", authenticatorData: "YXV0aA", signature: "c2ln", userHandle: "dXNlcg" },
      },
    });
    for (const a of site.api) assert.ok(!a.url.includes("?"), "nothing in a request URL");
    await site.context.close();
  });

  it("shows a refusal and a cancelled prompt the same way, and Try again asks again", async () => {
    const refused = await open("/sign-in", { script: { ...PASSKEY_OK, "POST sign-in/passkey": [{ status: 401, body: { error: "sign_in_refused" } }, { status: 200, body: {} }], ...CLASSES } });
    await press(refused.page, "Sign in with a passkey");
    await refused.page.waitForSelector(".plate");
    const cancelled = await open("/sign-in", { passkey: "cancel", script: PASSKEY_OK });
    await press(cancelled.page, "Sign in with a passkey");
    await cancelled.page.waitForSelector(".plate");
    assert.equal(await mainHtml(cancelled.page), await mainHtml(refused.page));
    assert.deepEqual(cancelled.api.map((a) => a.route), ["POST sign-in/passkey/options"]);
    await press(refused.page, "Try again");
    await refused.page.waitForSelector("nav .a.cur");
    assert.deepEqual(refused.api.map((a) => a.route), ["POST sign-in/passkey/options", "POST sign-in/passkey", "POST sign-in/passkey/options", "POST sign-in/passkey", "GET classes"]);
    await refused.context.close();
    await cancelled.context.close();
  });

  it("names failed sign-ins only on their own limit, not on the options' limit or a busy answer (#257)", async () => {
    const tooMany = (wait: string) => ({ status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": wait } });
    const cases = [
      { name: "failed sign-ins", script: { ...PASSKEY_OK, "POST sign-in/passkey": tooMany("420") }, words: /^Please try again in about 7 minutes\. After 10 passkey sign-ins that fail within 10 minutes/ },
      { name: "options' limit", script: { "POST sign-in/passkey/options": tooMany("420") }, words: /^Please try again in about 7 minutes\.$/ },
      { name: "busy", script: { ...PASSKEY_OK, "POST sign-in/passkey": tooMany("1") }, words: /^Please try again in a moment\.$/ },
    ];
    for (const c of cases) {
      const site = await open("/sign-in", { script: c.script });
      await press(site.page, "Sign in with a passkey");
      await site.page.waitForSelector(".plate");
      const [head, detail] = (await site.page.innerText(".plate")).split("\n").map((s) => s.trim()).filter(Boolean);
      assert.equal(head, "Too many sign-in requests", c.name);
      assert.match(detail, c.words, c.name);
      await site.context.close();
    }
  });

  it("is not offered where the browser has no passkeys", async () => {
    const site = await open("/sign-in", { passkey: "absent" });
    assert.doesNotMatch(await site.page.innerText("main"), /passkey/i);
    await site.context.close();
  });
});

describe("the way back and signing out", () => {
  it("returns to the page that asked, with its query, and keeps it out of the sign-in address", async () => {
    const site = await open("/pair?code=AB12-CD34", { script: { "GET sessions": [{ status: 401, body: { error: "not_signed_in" } }, { status: 200, body: { sessions: [] } }], ...PASSKEY_OK } });
    await site.page.waitForSelector(".note");
    assert.equal(site.page.url(), `${ORIGIN}/sign-in`);
    assert.match(await site.page.innerText(".note"), /signed out|session/i);
    await press(site.page, "Sign in with a passkey");
    await waitForApi(site, 4);
    assert.equal(path(site.page), "/pair?code=AB12-CD34");
    assert.deepEqual((await traps(site.page)).filter((x) => x.kind === "storage"), [], "the way back is kept in memory only");
    await site.context.close();
  });

  it("never returns to another site", async () => {
    const site = await open("//evil.example/classes", { script: { ...PASSKEY_OK, ...CLASSES } });
    await site.page.waitForSelector("h1");
    assert.deepEqual(site.api, [], "an address that is not a page of the site loads nothing");
    assert.equal(new URL(site.page.url()).origin, ORIGIN);
    await site.context.close();
  });

  it("signs out with one request and opens Sign in with the notice", async () => {
    const site = await open("/classes", { script: { ...CLASSES, "POST sign-out": { status: 204 } } });
    await site.page.waitForSelector("nav .a.cur");
    await press(site.page, "Sign out");
    await site.page.waitForSelector(".note");
    assert.equal(path(site.page), "/sign-in");
    assert.deepEqual(site.api.map((a) => a.route), ["GET classes", "POST sign-out"]);
    assert.equal(site.api[1].body, null);
    await site.context.close();
  });

  it("stays signed in and says so when signing out fails", async () => {
    const site = await open("/classes", { script: { ...CLASSES, "POST sign-out": { status: 503, body: { error: "unavailable" } } } });
    await site.page.waitForSelector("nav .a.cur");
    await press(site.page, "Sign out");
    await site.page.waitForSelector(".plate");
    assert.equal(path(site.page), "/classes");
    await site.context.close();
  });
});
