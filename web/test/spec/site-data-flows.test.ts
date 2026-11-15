// Account: Your data on the fake backend (docs/design/site.md, "Your data"; ADR 0002, sections 10
// and 11): the export saved as class-player-export.json with the "started" note, the daily limit
// from `Retry-After` with the button disabled, and deleting the account in a panel that replaces
// the page, "Keep my account" first and focused, Esc keeping it, the server deciding on the typed
// address. A 403 `recent_sign_in_required` shows the shared "Confirm it is you".
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { launchOffline, openSite } from "../lib/site-fake.ts";
import type { FakeSite, Script } from "../lib/site-fake.ts";
import { EXPORT_BODY, EXPORT_FILE, EXPORTED, SIGNED_IN, TYPED } from "../lib/site-data-states.ts";

const EXPORT = "POST account/export";
const DELETE = "POST account/delete";
const RECENT = { status: 403, body: { error: "recent_sign_in_required" } } as const;

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const open = async (script: Script = {}): Promise<FakeSite> => {
  const site = await openSite(browser, "/account/data", { width: 390, height: 844, script: { ...SIGNED_IN, ...script } });
  await site.page.waitForSelector("[data-export]");
  return site;
};
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).first().click();
const active = (page: Page): Promise<string> => page.evaluate(() => (document.activeElement?.textContent ?? "").trim());
const routes = (site: FakeSite, route: string): number => site.api.filter((a) => a.route === route).length;
const openPanel = (page: Page): Promise<void> => press(page, "Delete my account…");

describe("the page", () => {
  it("sits in the account frame, Your data current, with both sections", async () => {
    const site = await open();
    assert.equal(await site.page.locator(".subnav [aria-current=page]").innerText(), "Your data");
    assert.equal(await site.page.locator("h1").innerText(), "Account");
    assert.deepEqual(await site.page.locator(".acct-body h2").allInnerTexts(), ["Export your data", "Delete your account"]);
    const text = await site.page.locator(".acct-body").innerText();
    assert.match(text, /You can export 3 times a day\. The file is made when you ask and is not kept\./);
    assert.match(text, /It cannot be undone\./);
    assert.deepEqual(site.api.map((a) => a.route), ["GET me"]);
    await site.context.close();
  });
});

describe("export", () => {
  it("POST account/export saves class-player-export.json and shows the started note", async () => {
    const site = await open({ [EXPORT]: EXPORTED });
    const [download] = await Promise.all([site.page.waitForEvent("download"), press(site.page, "Download export")]);
    assert.equal(download.suggestedFilename(), EXPORT_FILE);
    const { readFile } = await import("node:fs/promises");
    assert.deepEqual(JSON.parse(await readFile(await download.path(), "utf8")), EXPORT_BODY);
    await site.page.waitForSelector(".note");
    assert.match(await site.page.locator(".note").innerText(), /Your export has started[\s\S]*class-player-export\.json\. If the file looks cut off, ask for the export again\./);
    assert.equal(await site.page.evaluate(() => document.activeElement?.classList.contains("note") ?? false), true);
    assert.equal(routes(site, EXPORT), 1);
    // The link the file was handed over by is not left in the page.
    assert.equal(await site.page.locator("a[download], a[href^='blob:']").count(), 0);
    await site.context.close();
  });

  it("on 429 shows the limit with the hours from Retry-After, the button disabled", async () => {
    for (const [after, words] of [["25200", "in about 7 hours"], ["3000", "in about 1 hour"], ["86400", "in about 24 hours"]] as const) {
      const site = await open({ [EXPORT]: { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": after } } });
      await press(site.page, "Download export");
      await site.page.waitForSelector(".plate");
      assert.match(await site.page.locator(".plate").innerText(), new RegExp(`No more exports today[\\s\\S]*You can export 3 times a day\\. Try again ${words}\\.`));
      const b = site.page.locator("[data-export]");
      assert.equal(await b.isDisabled(), true);
      assert.equal(await b.getAttribute("aria-describedby"), await site.page.locator(".plate").getAttribute("id"));
      await b.click({ force: true });
      assert.equal(routes(site, EXPORT), 1, after);
      await site.context.close();
    }
  });

  it("offline, 'Download export' is off under the plate, and the export is asked for again by 'Try again' and once back online (#441)", async () => {
    const offline = { status: 0, fail: true } as const;
    const site = await open({ [EXPORT]: [offline, offline, EXPORTED] });
    await press(site.page, "Download export");
    await site.page.waitForSelector(".plate");
    assert.match(await site.page.locator(".plate").innerText(), /You are offline/);
    const b = site.page.locator("[data-export]");
    assert.equal(await b.isDisabled(), true, "Download export is off while offline");
    assert.equal(await b.getAttribute("aria-describedby"), await site.page.locator(".plate").getAttribute("id"));
    assert.equal(await site.page.getByRole("button", { name: "Delete my account…", exact: true }).isDisabled(), false, "the rest of the page stays on");
    await b.click({ force: true });
    assert.equal(routes(site, EXPORT), 1, "a press on the disabled button sends nothing");
    // "Try again" on the plate asks again; still offline, the plate and the disabled button stay.
    await press(site.page, "Try again");
    await site.page.waitForSelector(".plate");
    assert.equal(routes(site, EXPORT), 2);
    assert.equal(await b.isDisabled(), true);
    assert.equal(await b.getAttribute("aria-describedby"), await site.page.locator(".plate").getAttribute("id"));
    // Back online, the page asks once by itself, and the file is saved.
    const [download] = await Promise.all([site.page.waitForEvent("download"), site.page.evaluate(() => window.dispatchEvent(new Event("online")))]);
    assert.equal(download.suggestedFilename(), EXPORT_FILE);
    await site.page.waitForSelector(".note");
    assert.equal(routes(site, EXPORT), 3);
    assert.equal(await b.isDisabled(), false);
    assert.equal(await b.getAttribute("aria-describedby"), null);
    await site.page.evaluate(() => window.dispatchEvent(new Event("online")));
    assert.equal(routes(site, EXPORT), 3, "asked once only");
    await site.context.close();
  });

  it("offline, a deletion's plate does not turn the export off once the panel is closed", async () => {
    const site = await open({ [DELETE]: { status: 0, fail: true } });
    await openPanel(site.page);
    await site.page.locator("input[name=confirm]").fill(TYPED);
    await press(site.page, "Delete everything");
    await site.page.waitForSelector(".plate");
    await press(site.page, "Keep my account");
    assert.equal(await site.page.locator("[data-export]").isDisabled(), false);
    assert.equal(await site.page.locator("[data-export]").getAttribute("aria-describedby"), null);
    await site.context.close();
  });

  it("asks to confirm it is you on 403 recent_sign_in_required, and sends nothing again", async () => {
    const site = await open({ [EXPORT]: RECENT });
    await press(site.page, "Download export");
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    assert.match(await site.page.locator(".plate").innerText(), /Confirm it is you/);
    assert.deepEqual(await site.page.locator(".plate button").allInnerTexts(), ["Confirm with classbeat"]);
    await site.page.waitForTimeout(100);
    assert.equal(routes(site, EXPORT), 1);
    await site.context.close();
  });

  it("a session that ended goes to Sign in", async () => {
    const site = await open({ [EXPORT]: { status: 401, body: { error: "not_signed_in" } } });
    await press(site.page, "Download export");
    await site.page.waitForSelector("input[name=email]");
    assert.equal(new URL(site.page.url()).pathname, "/sign-in");
    await site.context.close();
  });
});

describe("delete", () => {
  it("replaces the page with the panel, 'Keep my account' first and focused", async () => {
    const site = await open();
    await openPanel(site.page);
    const panel = site.page.locator("[role=alertdialog]");
    assert.match(await panel.innerText(), /Delete your account\?[\s\S]*Type your email address to confirm\./);
    assert.deepEqual(await panel.locator("button").allInnerTexts(), ["Keep my account", "Delete everything"]);
    assert.equal(await active(site.page), "Keep my account");
    assert.equal(await site.page.locator("[data-export]").count(), 0);
    assert.equal(await site.page.locator("label", { hasText: "Your email address" }).count(), 1);
    await site.context.close();
  });

  it("enables 'Delete everything' once the field is not empty", async () => {
    const site = await open();
    await openPanel(site.page);
    const del = site.page.getByRole("button", { name: "Delete everything" });
    assert.equal(await del.isDisabled(), true);
    await site.page.locator("input[name=confirm]").pressSequentially("   ");
    assert.equal(await del.isDisabled(), true);
    await site.page.locator("input[name=confirm]").pressSequentially("a");
    assert.equal(await del.isDisabled(), false);
    await site.page.locator("input[name=confirm]").fill("");
    assert.equal(await del.isDisabled(), true);
    await site.page.locator("input[name=confirm]").press("Enter");
    assert.equal(routes(site, DELETE), 0);
    await site.context.close();
  });

  it("Esc picks 'Keep my account' and returns focus to 'Delete my account…'", async () => {
    const site = await open();
    await openPanel(site.page);
    await site.page.locator("input[name=confirm]").fill(TYPED);
    await site.page.keyboard.press("Escape");
    assert.equal(await site.page.locator("[role=alertdialog]").count(), 0);
    assert.equal(await active(site.page), "Delete my account…");
    await openPanel(site.page);
    assert.equal(await site.page.inputValue("input[name=confirm]"), "", "the typed address is not kept");
    await press(site.page, "Keep my account");
    assert.equal(await active(site.page), "Delete my account…");
    assert.equal(routes(site, DELETE), 0);
    await site.context.close();
  });

  it("sends what was typed, case and all; 422 confirmation_mismatch is the field error and nothing goes", async () => {
    const site = await open({ [DELETE]: { status: 422, body: { error: "confirmation_mismatch" } } });
    await openPanel(site.page);
    await site.page.locator("input[name=confirm]").fill(" Ana@Example.com ");
    await site.page.locator("input[name=confirm]").press("Enter");
    await site.page.waitForSelector(".field.err");
    assert.deepEqual(site.api.filter((a) => a.route === DELETE).map((a) => JSON.parse(a.body ?? "null") as unknown), [{ confirm: "Ana@Example.com" }], "the case is left to the server");
    assert.match(await site.page.locator(".field .error").innerText(), /That is not the email address of this account\./);
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name ?? ""), "confirm");
    assert.equal(await site.page.getAttribute("input[name=confirm]", "aria-invalid"), "true");
    assert.equal(new URL(site.page.url()).pathname, "/account/data");
    await site.context.close();
  });

  it("204 goes to the signed-out page with 'Your account was deleted'", async () => {
    const site = await open({ [DELETE]: { status: 204 } });
    await openPanel(site.page);
    await site.page.locator("input[name=confirm]").fill(TYPED);
    await press(site.page, "Delete everything");
    await site.page.waitForSelector(".note");
    assert.equal(new URL(site.page.url()).pathname, "/sign-in");
    assert.match(await site.page.locator(".note").innerText(), /Your account was deleted/);
    assert.equal(await site.page.locator("nav[aria-label=Main]").count(), 0);
    await site.context.close();
  });

  it("403 recent_sign_in_required closes the panel and shows 'Confirm it is you'", async () => {
    const site = await open({ [DELETE]: RECENT });
    await openPanel(site.page);
    await site.page.locator("input[name=confirm]").fill(TYPED);
    await press(site.page, "Delete everything");
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    assert.equal(await site.page.locator("[role=alertdialog]").count(), 0);
    assert.equal(await site.page.evaluate(() => document.activeElement?.classList.contains("plate") ?? false), true);
    await site.page.waitForTimeout(100);
    assert.equal(routes(site, DELETE), 1);
    await site.context.close();
  });

  it("offline, the panel stays under a plate with the address; a session that ended goes to Sign in", async () => {
    const off = await open({ [DELETE]: { status: 0, fail: true } });
    await openPanel(off.page);
    await off.page.locator("input[name=confirm]").fill(TYPED);
    await press(off.page, "Delete everything");
    await off.page.waitForSelector(".plate + .ac-panel");
    assert.match(await off.page.locator(".plate").innerText(), /You are offline/);
    assert.equal(await off.page.inputValue("input[name=confirm]"), TYPED);
    await off.context.close();
    const ended = await open({ [DELETE]: { status: 401, body: { error: "not_signed_in" } } });
    await openPanel(ended.page);
    await ended.page.locator("input[name=confirm]").fill(TYPED);
    await press(ended.page, "Delete everything");
    await ended.page.waitForSelector("input[name=email]");
    assert.equal(new URL(ended.page.url()).pathname, "/sign-in");
    await ended.context.close();
  });
});
