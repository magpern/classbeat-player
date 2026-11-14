// Account: Linked apps on the fake backend (docs/design/site.md, "Account"; ADR 0002, section 7):
// the list inside the account frame, none, and revoking in place with "Keep it" as the default,
// `DELETE source-links/{id}` and the "Revoked" note.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { launchOffline, openSite } from "../lib/site-fake.ts";
import type { FakeSite, Script } from "../lib/site-fake.ts";
import { LINKS, LINKS_LISTED } from "../lib/site-link-states.ts";

const FIRST = LINKS[0];
const DELETE_FIRST = `DELETE source-links/${FIRST.id}`;

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const open = async (script: Script = {}, ready = ".ac-item"): Promise<FakeSite> => {
  const site = await openSite(browser, "/account/links", { width: 390, height: 844, script: { ...LINKS_LISTED, ...script }, clock: "day" });
  await site.page.waitForSelector(ready);
  return site;
};
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).first().click();
const active = (page: Page): Promise<string> => page.evaluate(() => (document.activeElement?.textContent ?? "").trim());
const deletes = (site: FakeSite): string[] => site.api.filter((a) => a.method === "DELETE").map((a) => a.route);

describe("the list", () => {
  it("sits in the account frame with the four sub-page links, Linked apps current", async () => {
    const site = await open();
    assert.deepEqual(await site.page.locator(".subnav a").allInnerTexts(), ["Sessions", "Passkeys", "Linked apps", "Your data"]);
    assert.equal(await site.page.locator(".subnav [aria-current=page]").innerText(), "Linked apps");
    assert.equal(await site.page.locator("h1").innerText(), "Account");
    await site.context.close();
  });

  it("shows each app with its linked date and last use, and the count", async () => {
    const site = await open();
    assert.match(await site.page.locator(".acct-body").innerText(), /An app you link can send classes to your account and remove the ones it sent\. It sees nothing else\./);
    assert.match(await site.page.locator(".acct-body").innerText(), /2 of 5 apps/);
    const rows = await site.page.locator(".ac-item").allInnerTexts();
    assert.deepEqual(rows.map((r) => r.split("\n")[0]), ["classbeat", "Spin notes"]);
    assert.match(rows[0], /Linked 2 Nov/);
    assert.match(rows[0], /Last used 12 Nov/);
    assert.match(rows[1], /Linked 1 Dec 2025/);
    assert.match(rows[1], /Not used yet/);
    await site.context.close();
  });

  it("sets a name as text, never as markup", async () => {
    const odd = { ...FIRST, name: '<img src=x onerror="go()">' };
    const site = await open({ "GET source-links": { status: 200, body: { source_links: [odd] } } });
    assert.equal(await site.page.locator(".ac-t").first().innerText(), odd.name);
    assert.equal(await site.page.locator("main img").count(), 0);
    await site.context.close();
  });

  it("refuses a body it does not understand: an id that is not a uuid is the server fault", async () => {
    for (const id of ["../sessions", FIRST.id.toUpperCase(), ""]) {
      const site = await open({ "GET source-links": { status: 200, body: { source_links: [{ ...FIRST, id }] } } }, ".plate");
      assert.equal(await site.page.locator(".ac-item").count(), 0, id);
      await site.context.close();
    }
  });

  it("with no apps, says how to link one", async () => {
    const site = await open({ "GET source-links": { status: 200, body: { source_links: [] } } }, ".acct-body h2");
    assert.match(await site.page.locator(".acct-body").innerText(), /No apps are linked\. In classbeat, choose Connect player\./);
    assert.equal(await site.page.locator(".ac-item").count(), 0);
    await site.context.close();
  });
});

describe("revoke", () => {
  it("asks in place, with 'Keep it' first and focused; Enter on it keeps the app", async () => {
    const site = await open();
    await press(site.page, "Revoke");
    const panel = site.page.locator("[role=alertdialog]");
    assert.match(await panel.innerText(), /Revoke “classbeat”\?/);
    assert.match(await panel.innerText(), /It can no longer send classes\. The classes already in your library stay\./);
    assert.deepEqual(await panel.locator("button").allInnerTexts(), ["Keep it", "Revoke app"]);
    assert.equal(await active(site.page), "Keep it");
    await site.page.keyboard.press("Enter");
    assert.equal(await panel.count(), 0);
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.link ?? ""), FIRST.id);
    assert.deepEqual(deletes(site), []);
    await site.context.close();
  });

  it("Esc cancels and returns focus to the row's Revoke", async () => {
    const site = await open();
    await press(site.page, "Revoke");
    await site.page.keyboard.press("Escape");
    assert.equal(await site.page.locator("[role=alertdialog]").count(), 0);
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.link ?? ""), FIRST.id);
    assert.deepEqual(deletes(site), []);
    await site.context.close();
  });

  it("sends DELETE source-links/{id}, says so, shortens the list and moves focus to the next row", async () => {
    const site = await open({ [DELETE_FIRST]: { status: 204 } });
    await press(site.page, "Revoke");
    await press(site.page, "Revoke app");
    await site.page.waitForSelector(".note");
    assert.deepEqual(deletes(site), [DELETE_FIRST]);
    assert.match(await site.page.locator(".note").innerText(), /Revoked “classbeat”/);
    assert.deepEqual((await site.page.locator(".ac-item").allInnerTexts()).map((r) => r.split("\n")[0]), ["Spin notes"]);
    assert.match(await site.page.locator(".acct-body").innerText(), /1 of 5 apps/);
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.link ?? ""), LINKS[1].id);
    await site.context.close();
  });

  it("an app already gone (404) reads the list again", async () => {
    const site = await open({ [DELETE_FIRST]: { status: 404, body: { error: "not_found" } }, "GET source-links": [{ status: 200, body: { source_links: LINKS } }, { status: 200, body: { source_links: [LINKS[1]] } }] });
    await press(site.page, "Revoke");
    await press(site.page, "Revoke app");
    await site.page.waitForFunction(() => document.querySelectorAll(".ac-item").length === 1);
    assert.equal(site.api.filter((a) => a.route === "GET source-links").length, 2);
    await site.context.close();
  });

  it("offline, the panel stays under a plate; a session that ended goes to Sign in", async () => {
    const off = await open({ [DELETE_FIRST]: { status: 0, fail: true } });
    await press(off.page, "Revoke");
    await press(off.page, "Revoke app");
    await off.page.waitForSelector(".plate");
    assert.match(await off.page.locator(".plate").innerText(), /You are offline/);
    await off.context.close();
    const ended = await open({ [DELETE_FIRST]: { status: 401, body: { error: "not_signed_in" } } });
    await press(ended.page, "Revoke");
    await press(ended.page, "Revoke app");
    await ended.page.waitForSelector("input[name=email]");
    assert.equal(new URL(ended.page.url()).pathname, "/sign-in");
    await ended.context.close();
  });
});
