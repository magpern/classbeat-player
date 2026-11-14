// The account Sessions page on the fake backend (docs/design/site.md, "Account" and "Keyboard"):
// "This browser" as a word in an outline, "Sign out" on its row and "End session" on every other,
// ending one session in place, and "Sign out everywhere" asking in a panel first. A 403 asks the
// person to confirm it is them and sends nothing again by itself.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { launchOffline, openSite, settled } from "../lib/site-fake.ts";
import type { FakeSite, Script } from "../lib/site-fake.ts";
import { RECENT, SESSIONS, SESSIONS_LISTED } from "../lib/site-account-states.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const open = async (script: Script = {}, ready = ".ac-item"): Promise<FakeSite> => {
  const site = await openSite(browser, "/account/sessions", { width: 390, height: 844, script: { ...SESSIONS_LISTED, ...script }, clock: "day" });
  await site.page.waitForSelector(ready);
  return site;
};
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).first().click();
const active = (page: Page): Promise<string> => page.evaluate(() => (document.activeElement?.textContent ?? "").trim());
const sent = (site: FakeSite, route: string): number => site.api.filter((a) => a.route === route).length;
const openPanel = async (site: FakeSite): Promise<void> => {
  await press(site.page, "Sign out everywhere");
  await site.page.waitForSelector("[role=alertdialog]");
};
const confirmEndAll = (site: FakeSite): Promise<void> => site.page.locator("[role=alertdialog]").getByRole("button", { name: "Sign out everywhere" }).click();

describe("the list", () => {
  it("shows each session in the backend's order, with 'This browser' as an outlined word", async () => {
    const site = await open();
    const rows = site.page.locator(".ac-item");
    assert.equal(await rows.count(), 3);
    assert.deepEqual((await rows.allInnerTexts()).map((r) => r.split("\n")[0].trim()), ["Firefox This browser", "Safari", "Chrome"]);
    const tag = rows.first().locator(".tag");
    assert.equal(await tag.innerText(), "This browser");
    // A word in an outline, never colour alone: a border, and the same text colour as the row.
    const look = await tag.evaluate((e) => {
      const s = getComputedStyle(e);
      return { border: s.borderTopStyle, width: parseFloat(s.borderTopWidth), color: s.color, row: getComputedStyle(e.closest(".ac-item") as Element).color };
    });
    assert.equal(look.border, "solid");
    assert.ok(look.width >= 1);
    assert.equal(look.color, look.row, "the tag is not told apart by colour");
    assert.equal(await site.page.locator(".tag").count(), 1);
    assert.match(await rows.first().innerText(), /Started 12 Nov/);
    await site.context.close();
  });

  it("labels the current row 'Sign out' and every other 'End session'", async () => {
    const site = await open();
    const labels = await site.page.locator(".ac-item button").allInnerTexts();
    assert.deepEqual(labels.map((l) => l.trim()), ["Sign out", "End session", "End session"]);
    await site.context.close();
  });

  it("refuses a body it does not understand: two current sessions are the server fault", async () => {
    const two = SESSIONS.map((s) => ({ ...s, current: true }));
    const site = await open({ "GET sessions": { status: 200, body: { sessions: two } } }, ".plate");
    assert.equal(await site.page.locator(".ac-item").count(), 0);
    await site.context.close();
  });

  it("sets a browser name as text, never as markup", async () => {
    const odd = [{ ...SESSIONS[0], browser: '<img src=x onerror="go()">' }];
    const site = await open({ "GET sessions": { status: 200, body: { sessions: odd } } });
    assert.match(await site.page.locator(".ac-t").first().innerText(), /<img src=x/);
    assert.equal(await site.page.locator("main img").count(), 0);
    await site.context.close();
  });
});

describe("ending a session", () => {
  it("'Sign out' on this browser signs out, as the header's button does", async () => {
    const site = await open({ "POST sign-out": { status: 204 } });
    await site.page.locator(`[data-session="${SESSIONS[0].id}"]`).click();
    await site.page.waitForURL(/\/sign-in$/);
    assert.equal(sent(site, "POST sign-out"), 1);
    assert.equal(sent(site, `DELETE sessions/${SESSIONS[0].id}`), 0);
    await site.context.close();
  });

  it("'End session' ends that one at once, shows the note and moves focus to the next row", async () => {
    const route = `DELETE sessions/${SESSIONS[1].id}`;
    const site = await open({ [route]: { status: 204 } });
    await site.page.locator(`[data-session="${SESSIONS[1].id}"]`).click();
    await site.page.waitForSelector(".note");
    assert.equal(sent(site, route), 1);
    assert.match(await site.page.locator(".note").innerText(), /Ended the session in Safari/);
    assert.equal(await site.page.locator(".ac-item").count(), 2);
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.session ?? ""), SESSIONS[2].id);
    await site.context.close();
  });

  it("the last row ended moves focus to the row before it", async () => {
    const route = `DELETE sessions/${SESSIONS[2].id}`;
    const site = await open({ [route]: { status: 204 } });
    await site.page.locator(`[data-session="${SESSIONS[2].id}"]`).click();
    await site.page.waitForSelector(".note");
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.session ?? ""), SESSIONS[1].id);
    await site.context.close();
  });

  it("a session already gone reads the list again", async () => {
    const route = `DELETE sessions/${SESSIONS[1].id}`;
    const fewer = { status: 200, body: { sessions: [SESSIONS[0], SESSIONS[2]] } };
    const site = await open({ "GET sessions": [SESSIONS_LISTED["GET sessions"] as never, fewer], [route]: { status: 404, body: { error: "not_found" } } });
    await site.page.locator(`[data-session="${SESSIONS[1].id}"]`).click();
    await site.page.waitForFunction(() => document.querySelectorAll(".ac-item").length === 2);
    assert.equal(sent(site, "GET sessions"), 2);
    await site.context.close();
  });

  it("a 401 ends the page's session: back to Sign in", async () => {
    const route = `DELETE sessions/${SESSIONS[1].id}`;
    const site = await open({ [route]: { status: 401, body: { error: "not_signed_in" } } });
    await site.page.locator(`[data-session="${SESSIONS[1].id}"]`).click();
    await site.page.waitForURL(/\/sign-in$/);
    await site.context.close();
  });
});

describe("sign out everywhere", () => {
  it("opens its panel with 'Cancel' first and focused; Esc closes it and focus returns", async () => {
    const site = await open();
    await openPanel(site);
    const panel = site.page.locator("[role=alertdialog]");
    assert.match(await panel.innerText(), /Sign out everywhere\?/);
    assert.deepEqual((await panel.locator("button").allInnerTexts()).map((t) => t.trim()), ["Cancel", "Sign out everywhere"]);
    assert.equal(await active(site.page), "Cancel");
    await site.page.keyboard.press("Escape");
    assert.equal(await panel.count(), 0);
    assert.equal(await active(site.page), "Sign out everywhere");
    // Enter on the default cancels too.
    await openPanel(site);
    await site.page.keyboard.press("Enter");
    assert.equal(await panel.count(), 0);
    assert.equal(sent(site, "POST sessions/end-all"), 0);
    await site.context.close();
  });

  it("signs every session out and goes to Sign in", async () => {
    const site = await open({ "POST sessions/end-all": { status: 204 } });
    await openPanel(site);
    await confirmEndAll(site);
    await site.page.waitForURL(/\/sign-in$/);
    assert.equal(sent(site, "POST sessions/end-all"), 1);
    await site.context.close();
  });

  it("a 403 asks to confirm it is you, and the request is not sent again by itself", async () => {
    const site = await open({ "POST sessions/end-all": RECENT });
    await openPanel(site);
    await confirmEndAll(site);
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    assert.match(await site.page.locator(".plate").innerText(), /Confirm it is you/);
    assert.equal(await site.page.locator("[role=alertdialog]").count(), 0);
    await settled(site, 600);
    assert.equal(sent(site, "POST sessions/end-all"), 1);
    assert.ok(new URL(site.page.url()).pathname === "/account/sessions");
    await site.context.close();
  });

  it("offline keeps the panel open under the plate", async () => {
    const site = await open({ "POST sessions/end-all": { status: 0, fail: true } });
    await openPanel(site);
    await confirmEndAll(site);
    await site.page.waitForSelector(".plate");
    assert.equal(await site.page.locator("[role=alertdialog]").count(), 1);
    await site.context.close();
  });
});
