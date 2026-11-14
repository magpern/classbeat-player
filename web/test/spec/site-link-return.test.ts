// A sign-in by email link opened in a new tab returns to the companion (#329; ADR 0006,
// decisions 4 and 5): the link request carries the entry read from the sign-in fragment, the
// fake backend mails it after the token, and a new page that opens the mail's link signs in and
// loads the companion. Nothing is kept in storage on the way.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { ORIGIN, launchOffline, openSite, traps, waitForApi } from "../lib/site-fake.ts";
import type { FakeSite, OpenOptions, Script } from "../lib/site-fake.ts";
import { EMAIL, LINK_TOKEN, PASSKEY_OPTIONS } from "../lib/site-states.ts";

const SIZE = { width: 390, height: 844 } as const;
const JOIN = "BCDF-GHJK";
const CLASSES = { "GET classes": { status: 200, body: { classes: [], next: null } } } as const;
const COMPLETE_OK = { "POST sign-in/complete": { status: 200, body: { status: "signed_in" } } } as const;
const PASSKEY_OK = { "POST sign-in/passkey/options": { status: 200, body: PASSKEY_OPTIONS }, "POST sign-in/passkey": { status: 200, body: { status: "signed_in" } } } as const;

let browser: Browser;
const open = (path: string, o: Partial<OpenOptions> = {}): Promise<FakeSite> => openSite(browser, path, { ...SIZE, ...o });
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).click();
const path = (page: Page): string => page.url().slice(ORIGIN.length);
const storage = async (page: Page): Promise<unknown[]> => (await traps(page)).filter((x) => x.kind === "storage");

before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

/** Asks for a link on `site`'s sign-in page and returns the one link mailed for it. */
async function askLink(site: FakeSite, mailbox: string[]): Promise<string> {
  await site.page.waitForSelector("input[name=email]");
  await site.page.fill("input[name=email]", EMAIL);
  await press(site.page, "Email me a sign-in link");
  await site.page.waitForSelector(".note");
  assert.equal(mailbox.length, 1, "one link is mailed");
  assert.deepEqual(await storage(site.page), [], "nothing is kept in storage");
  return mailbox[0];
}

/** Opens the mailed link in a new page (a new tab that shares nothing with the first) and signs in. */
async function signInByLink(link: string, script: Script): Promise<FakeSite> {
  assert.ok(link.startsWith(`${ORIGIN}/sign-in#`), link);
  const tab = await open(link.slice(ORIGIN.length), { script });
  await tab.page.waitForSelector(".btn.primary:focus");
  assert.equal(tab.page.url(), `${ORIGIN}/sign-in`, "the whole fragment leaves the address bar at once");
  const history = (await traps(tab.page)).filter((x) => x.kind === "history");
  assert.deepEqual(history.map((x) => x.detail), ["replaceState /sign-in"]);
  assert.deepEqual((await traps(tab.page)).filter((x) => x.kind !== "history"), []);
  return tab;
}

describe("a sign-in by email link in a new tab (ADR 0006, decisions 4 and 5)", () => {
  it("returns to the companion with its class code when the link was asked for from /sign-in#return=control.CODE", async () => {
    const mailbox: string[] = [];
    const site = await open(`/sign-in#return=control.${JOIN}`, { mailbox });
    const link = await askLink(site, mailbox);
    const asked = site.api.filter((a) => a.route === "POST sign-in/link");
    assert.equal(asked.length, 1);
    assert.deepEqual(JSON.parse(asked[0].body ?? ""), { email: EMAIL, return_to: `control.${JOIN}` });
    assert.equal(new URL(asked[0].url).search, "", "nothing goes in the query");
    assert.equal(link, `${ORIGIN}/sign-in#${LINK_TOKEN}&return=control.${JOIN}`);
    await site.context.close();

    const tab = await signInByLink(link, COMPLETE_OK);
    await press(tab.page, "Sign in");
    await tab.page.waitForURL(`${ORIGIN}/control#${JOIN}`);
    assert.equal(await tab.page.title(), "Companion", "the companion page is loaded, not drawn by the site");
    assert.deepEqual(tab.api.map((a) => a.route), ["POST sign-in/complete"], "nothing is read on the way");
    assert.deepEqual(JSON.parse(tab.api[0].body ?? ""), { token: LINK_TOKEN }, "only the token goes to complete the sign-in");
    for (const u of tab.urls) assert.ok(!u.includes(LINK_TOKEN.slice(7)) && !u.includes(JOIN) && !u.includes("return=") && !u.includes("?"), `the fragment reached a server: ${u}`);
    assert.deepEqual(tab.external, []);
    assert.equal(await tab.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await tab.context.close();
  });

  it("returns to the companion without a class code when the entry had none", async () => {
    const mailbox: string[] = [];
    const site = await open("/sign-in#return=control", { mailbox });
    const link = await askLink(site, mailbox);
    assert.deepEqual(JSON.parse(site.api[0].body ?? ""), { email: EMAIL, return_to: "control" });
    await site.context.close();
    const tab = await signInByLink(link, COMPLETE_OK);
    await press(tab.page, "Sign in");
    await tab.page.waitForURL(`${ORIGIN}/control`);
    assert.equal(await tab.page.title(), "Companion");
    await tab.context.close();
  });

  it("lands on /classes when the link was asked for with no return entry", async () => {
    const mailbox: string[] = [];
    const site = await open("/sign-in", { mailbox });
    const link = await askLink(site, mailbox);
    assert.deepEqual(JSON.parse(site.api[0].body ?? ""), { email: EMAIL });
    assert.equal(link, `${ORIGIN}/sign-in#${LINK_TOKEN}`);
    await site.context.close();
    const tab = await signInByLink(link, { ...COMPLETE_OK, ...CLASSES });
    await press(tab.page, "Sign in");
    await tab.page.waitForSelector("nav .a.cur");
    assert.equal(path(tab.page), "/classes");
    await tab.context.close();
  });

  it("sends no return_to and no pairing code in any form when the link was asked for from /pair", async () => {
    const CODE = "AB12-CD34";
    const mailbox: string[] = [];
    const site = await open(`/pair?code=${CODE}`, { mailbox, script: { "GET sessions": { status: 401, body: { error: "not_signed_in" } } } });
    await site.page.waitForSelector(".note");
    assert.equal(path(site.page), "/sign-in");
    const link = await askLink(site, mailbox);
    const asked = site.api.filter((a) => a.route === "POST sign-in/link");
    assert.equal(asked.length, 1);
    assert.deepEqual(JSON.parse(asked[0].body ?? ""), { email: EMAIL }, "no return_to");
    for (const a of asked) {
      const sent = `${a.url} ${a.body ?? ""} ${JSON.stringify(a.headers)}`;
      for (const part of [CODE, "AB12", "CD34", "AB12CD34", "ab12", "pair", "code=", "return"]) assert.ok(!sent.includes(part), `${part} went with the link request`);
    }
    assert.equal(link, `${ORIGIN}/sign-in#${LINK_TOKEN}`, "the mailed link names no way back");
    await site.context.close();
    const tab = await signInByLink(link, { ...COMPLETE_OK, ...CLASSES });
    await press(tab.page, "Sign in");
    await tab.page.waitForSelector("nav .a.cur");
    assert.equal(path(tab.page), "/classes");
    await tab.context.close();
  });

  it("keeps the way back in memory after a refused link: a passkey in that tab still returns to the companion", async () => {
    const tab = await signInByLink(`${ORIGIN}/sign-in#${LINK_TOKEN}&return=control.${JOIN}`, { "POST sign-in/complete": { status: 401, body: { error: "sign_in_refused" } }, ...PASSKEY_OK });
    await press(tab.page, "Sign in");
    await tab.page.waitForSelector(".plate");
    assert.match(await tab.page.innerText(".plate"), /This link cannot be used/);
    assert.deepEqual(await storage(tab.page), []);
    await press(tab.page, "Sign in with a passkey");
    await tab.page.waitForURL(`${ORIGIN}/control#${JOIN}`);
    await tab.context.close();
  });

  it("asks for a new link with the entry after a refused link", async () => {
    const mailbox: string[] = [];
    const again = await open(`/sign-in#${LINK_TOKEN}&return=control.${JOIN}`, { mailbox, script: { "POST sign-in/complete": { status: 401, body: { error: "sign_in_refused" } } } });
    await again.page.waitForSelector(".btn.primary:focus");
    await press(again.page, "Sign in");
    await waitForApi(again, 1);
    const link = await askLink(again, mailbox);
    assert.deepEqual(JSON.parse(again.api[1].body ?? ""), { email: EMAIL, return_to: `control.${JOIN}` });
    assert.equal(link, `${ORIGIN}/sign-in#${LINK_TOKEN}&return=control.${JOIN}`);
    await again.context.close();
  });

  it("ignores a return part outside the table: the token still signs in, to /classes", async () => {
    const tab = await signInByLink(`${ORIGIN}/sign-in#${LINK_TOKEN}&return=/pair?code=AB12-CD34`, { ...COMPLETE_OK, ...CLASSES });
    await press(tab.page, "Sign in");
    await tab.page.waitForSelector("nav .a.cur");
    assert.equal(path(tab.page), "/classes");
    await tab.context.close();
  });

  it("shows a link with other text after the token as broken, without asking the backend", async () => {
    const tab = await open(`/sign-in#${LINK_TOKEN}&next=//evil.example`);
    await tab.page.waitForSelector(".plate");
    assert.equal(tab.page.url(), `${ORIGIN}/sign-in`);
    assert.deepEqual(tab.api, []);
    await tab.context.close();
  });
});
