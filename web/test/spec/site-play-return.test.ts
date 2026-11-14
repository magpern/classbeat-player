// The way back to the web player page (issue #396; ADR 0008, section 3; ADR 0006, decisions 2 to 6):
// a sign-in fragment `return=play.<id>` leads, after the sign-in, to a full page load of
// `/play#<id>`; the fragment leaves the address bar before the first request; the link request
// carries the entry's name; nothing is kept in storage. And the class details page's link.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { ORIGIN, launchOffline, openSite, traps } from "../lib/site-fake.ts";
import type { FakeSite, OpenOptions, Script } from "../lib/site-fake.ts";
import { CLASS_DETAILS_ID as ID, EMAIL, LINK_TOKEN, PASSKEY_OPTIONS } from "../lib/site-states.ts";

const SIZE = { width: 390, height: 844 } as const;
const COMPLETE_OK = { "POST sign-in/complete": { status: 200, body: { status: "signed_in" } } } as const;
const PASSKEY_OK = { "POST sign-in/passkey/options": { status: 200, body: PASSKEY_OPTIONS }, "POST sign-in/passkey": { status: 200, body: { status: "signed_in" } } } as const;

let browser: Browser;
const open = (path: string, o: Partial<OpenOptions> = {}): Promise<FakeSite> => openSite(browser, path, { ...SIZE, ...o });
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).click();
const storage = async (page: Page): Promise<unknown[]> => (await traps(page)).filter((x) => x.kind === "storage");

before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

async function askLink(site: FakeSite, mailbox: string[]): Promise<string> {
  await site.page.waitForSelector("input[name=email]");
  await site.page.fill("input[name=email]", EMAIL);
  await press(site.page, "Email me a sign-in link");
  await site.page.waitForSelector(".note");
  assert.equal(mailbox.length, 1);
  return mailbox[0];
}

describe("a sign-in that returns to the web player page", () => {
  for (const [name, entry, landing] of [
    ["a class", `play.${ID}`, `/play#${ID}`],
    ["the picker", "play", "/play"],
  ] as const) {
    it(`returns to ${name} after an email link opened in a new tab, in a full page load`, async () => {
      const mailbox: string[] = [];
      const site = await open(`/sign-in#return=${entry}`, { mailbox });
      assert.equal(site.page.url(), `${ORIGIN}/sign-in`, "the fragment leaves the address bar before anything is sent");
      assert.equal(site.api.length, 0, "no request was made before the address was cleaned");
      const link = await askLink(site, mailbox);
      assert.deepEqual(JSON.parse(site.api[0].body ?? ""), { email: EMAIL, return_to: entry }, "the entry's name, never a path");
      assert.equal(new URL(site.api[0].url).search, "");
      assert.equal(link, `${ORIGIN}/sign-in#${LINK_TOKEN}&return=${entry}`);
      assert.deepEqual(await storage(site.page), [], "nothing is kept in storage");
      await site.context.close();

      const tab = await open(link.slice(ORIGIN.length), { script: COMPLETE_OK });
      await tab.page.waitForSelector(".btn.primary:focus");
      assert.equal(tab.page.url(), `${ORIGIN}/sign-in`);
      const history = (await traps(tab.page)).filter((x) => x.kind === "history");
      assert.deepEqual(history.map((x) => x.detail), ["replaceState /sign-in"]);
      await press(tab.page, "Sign in");
      await tab.page.waitForURL(`${ORIGIN}${landing}`);
      assert.equal(await tab.page.title().then((x) => x.startsWith("Play")), true, "the play page is loaded in full, not drawn by the site");
      // The page's own API requests carry the class id in the route, by design (ADR 0008, section 2); no other request names the entry, the id or the token.
      for (const u of tab.urls) assert.ok(!u.includes(LINK_TOKEN.slice(7)) && !u.includes("return=") && (u.startsWith(`${ORIGIN}/api/`) || (!u.includes(ID) && !u.includes("?"))), `the fragment reached a server: ${u}`);
      assert.equal(await tab.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await tab.context.close();
    });
  }

  it("returns to the class after a passkey, with no storage", async () => {
    const site = await open(`/sign-in#return=play.${ID}`, { script: PASSKEY_OK });
    await site.page.waitForSelector("input[name=email]");
    await press(site.page, "Sign in with a passkey");
    await site.page.waitForURL(`${ORIGIN}/play#${ID}`);
    assert.equal(await site.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await site.context.close();
  });

  it("goes to /classes for an entry that is not exactly play.<canonical id>, and sends no return_to for it", async () => {
    for (const bad of [`play.${ID.toUpperCase()}`, "PLAY", "/play", `play.${ID}.x`]) {
      const mailbox: string[] = [];
      const site = await open(`/sign-in#return=${bad}`, { mailbox });
      await askLink(site, mailbox);
      assert.deepEqual(JSON.parse(site.api[0].body ?? ""), { email: EMAIL }, bad);
      await site.context.close();
    }
  });
});

describe("the class details page", () => {
  it("shows Play on this device, a plain link to /play#<id> that loads the page in full", async () => {
    const script: Script = { [`GET classes/${ID}`]: { status: 200, body: { class_id: ID } } };
    const site = await open(`/classes/${ID}`, { script });
    await site.page.waitForSelector(".btns a");
    const link = site.page.getByRole("link", { name: "Play on this device", exact: true });
    assert.equal(await link.getAttribute("href"), `/play#${ID}`);
    await link.click();
    await site.page.waitForURL(`${ORIGIN}/play#${ID}`);
    assert.equal(await site.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await site.context.close();
  });

  it("shows no link on a page that is not one class", async () => {
    const site = await open("/classes", { script: { "GET classes": { status: 200, body: { classes: [], next: null } } } });
    await site.page.waitForSelector("nav .a.cur");
    await site.page.waitForTimeout(100);
    assert.equal(await site.page.getByText("Play on this device").count(), 0);
    await site.context.close();
  });
});
