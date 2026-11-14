// Connect an app on the fake backend (docs/design/site.md, "Account"; ADR 0002, section 7): the
// check on load, the name from the route only, "Connect <name>" focused, "Cancel" to Linked apps,
// and the approval going only to the address `POST source-links/approve` returns. Nothing in the
// page's own address, query or fragment, ever chooses where the page goes.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { launchOffline, openSite, settled } from "../lib/site-fake.ts";
import type { FakeSite, Script } from "../lib/site-fake.ts";
import { APPROVED, BACK, CHECKED, CODE_CHALLENGE, CONNECT_PATH, LINK_CODE, LINKS_LISTED, REDIRECT_URI, SOURCE_STATE } from "../lib/site-link-states.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const EVIL = "https://evil.test/steal";
const signedIn: Script = { "GET sessions": { status: 200, body: { sessions: [] } } };
const asked = (approve?: Script[string], check: Script[string] = CHECKED): Script => ({ ...signedIn, ...LINKS_LISTED, "POST source-links/check": check, ...(approve ? { "POST source-links/approve": approve } : {}) });
const open = async (script: Script, path = CONNECT_PATH, ready = "[data-connect]:focus"): Promise<FakeSite> => {
  const site = await openSite(browser, path, { width: 390, height: 844, script });
  await site.page.waitForSelector(ready);
  return site;
};
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).click();
const routes = (site: FakeSite): string[] => site.api.map((a) => a.route);
const bodyOf = (site: FakeSite, route: string): unknown => JSON.parse(site.api.find((a) => a.route === route)?.body ?? "null");
/** Everything the page asked for or left for, and the page's own markup: none of it may name the attacker. */
async function neverEvil(site: FakeSite, checked = false): Promise<void> {
  await settled(site);
  for (const u of [...site.urls.slice(1), ...site.left, ...site.external]) assert.ok(!u.includes("evil"), `went to ${u}`);
  // The check may carry the address the query asked for: the backend decides, and the page never goes there.
  for (const a of site.api) if (!(checked && a.route === "POST source-links/check")) assert.ok(!(a.body ?? "").includes("evil"), `sent to ${a.route}`);
  assert.deepEqual(site.external, []);
  assert.ok(new URL(site.page.url()).origin === "https://site.test", site.page.url());
}

describe("on load", () => {
  it("checks the link with the source and its address only, and asks with the route's name", async () => {
    const site = await open(asked());
    assert.deepEqual(routes(site), ["GET sessions", "POST source-links/check"]);
    assert.deepEqual(bodyOf(site, "POST source-links/check"), { source: "classbeat", redirect_uri: REDIRECT_URI });
    assert.equal(await site.page.locator("h1").innerText(), "Connect classbeat?");
    assert.deepEqual(await site.page.locator("ul.plain li").allInnerTexts(), ["Send classes to your library", "Remove the classes it sent", "Read how many times it has sent each class"]);
    assert.deepEqual(await site.page.locator(".btns").last().locator("a, button").allInnerTexts(), ["Connect classbeat", "Cancel"]);
    assert.deepEqual(site.left, []);
    await site.context.close();
  });

  it("shows the name the route gives, as text, never one from the address", async () => {
    const odd = '<img src=x onerror="go()">';
    const site = await open(asked(undefined, { status: 200, body: { ...CHECKED.body, name: odd } }), `${CONNECT_PATH}&name=Your+bank`, "[data-connect]");
    assert.equal(await site.page.locator("h1").innerText(), `Connect ${odd}?`);
    assert.equal(await site.page.locator("main img").count(), 0);
    assert.ok(!(await site.page.locator("main").innerText()).includes("bank"));
    await site.context.close();
  });

  it("an unknown source or address (400) is a plate with no detail; nothing is approved and nothing redirects", async () => {
    const path = CONNECT_PATH.replace(encodeURIComponent(REDIRECT_URI), encodeURIComponent(EVIL));
    const site = await open(asked(undefined, { status: 400, body: { error: "unknown_source" } }), path, ".plate");
    assert.deepEqual(bodyOf(site, "POST source-links/check"), { source: "classbeat", redirect_uri: EVIL });
    assert.match(await site.page.locator(".plate").innerText(), /This link is not valid/);
    assert.equal(await site.page.locator(".plate").getByRole("link", { name: "Linked apps" }).getAttribute("href"), "/account/links");
    assert.equal(await site.page.locator("[data-connect]").count(), 0);
    assert.ok(!routes(site).includes("POST source-links/approve"));
    assert.deepEqual(site.left, []);
    await neverEvil(site, true);
    await site.context.close();
  });

  it("an address that is not a link (a part missing or given twice) is not valid, and is not even checked", async () => {
    for (const path of ["/link/source", `/link/source?source=classbeat&redirect_uri=${encodeURIComponent(EVIL)}`, `${CONNECT_PATH}&state=again`]) {
      const site = await open(asked(), path, ".plate");
      assert.deepEqual(routes(site), ["GET sessions"], path);
      assert.match(await site.page.locator(".plate").innerText(), /This link is not valid/);
      assert.deepEqual(site.left, []);
      await site.context.close();
    }
  });
});

describe("cancel", () => {
  it("goes to Linked apps on this site and approves nothing", async () => {
    const site = await open(asked());
    await site.page.getByRole("link", { name: "Cancel" }).click();
    await site.page.waitForSelector(".subnav .cur");
    assert.equal(new URL(site.page.url()).pathname, "/account/links");
    assert.ok(!routes(site).includes("POST source-links/approve"));
    assert.deepEqual(site.left, []);
    await site.context.close();
  });
});

describe("approve", () => {
  it("sends the approval as a script request, then goes only to the address it returns", async () => {
    const site = await open(asked(APPROVED));
    // Enter on the focused button approves (it is the person's press).
    await site.page.keyboard.press("Enter");
    await site.page.waitForSelector(".note");
    await settled(site);
    assert.deepEqual(bodyOf(site, "POST source-links/approve"), { source: "classbeat", redirect_uri: REDIRECT_URI, state: SOURCE_STATE, code_challenge: CODE_CHALLENGE, code_challenge_method: "S256" });
    assert.equal(site.api.find((a) => a.route === "POST source-links/approve")?.headers["content-type"], "application/json");
    assert.deepEqual(site.left, [BACK]);
    assert.match(await site.page.locator(".note").innerText(), /classbeat is connected/);
    // Blocked: the person goes back by the button, to the same address. The code is never in the page.
    await press(site.page, "Back to classbeat");
    await settled(site);
    assert.deepEqual(site.left, [BACK, BACK]);
    assert.ok(!(await site.page.content()).includes(LINK_CODE));
    assert.equal(await site.page.locator("main a[href*='source.test']").count(), 0);
    await site.context.close();
  });

  it("never follows an attacker's address in the query or the fragment", async () => {
    const lure = `&next=${encodeURIComponent(EVIL)}&redirect=${encodeURIComponent(EVIL)}&return_to=${encodeURIComponent(EVIL)}&redirect_url=${encodeURIComponent(EVIL)}#${EVIL}`;
    const site = await open(asked(APPROVED), CONNECT_PATH + lure);
    await press(site.page, "Connect classbeat");
    await site.page.waitForSelector(".note");
    assert.deepEqual(site.left, [BACK]);
    await press(site.page, "Back to classbeat");
    await settled(site);
    assert.deepEqual(site.left, [BACK, BACK]);
    await neverEvil(site);
    await site.context.close();
  });

  it("never follows an answer that is not the address asked for: the server plate, nothing left for", async () => {
    for (const redirect of ["javascript:alert(1)", `${EVIL}?code=${LINK_CODE}`, "/classes", "//evil.test/x", REDIRECT_URI, `${REDIRECT_URI}evil.test?code=c`]) {
      const site = await open(asked({ status: 200, body: { redirect } }));
      await press(site.page, "Connect classbeat");
      await site.page.waitForSelector(".plate");
      assert.match(await site.page.locator(".plate").innerText(), /That did not work/, redirect);
      assert.deepEqual(site.left, [], redirect);
      assert.equal(new URL(site.page.url()).pathname, "/link/source");
      // The question stays, so the person may press again.
      assert.equal(await site.page.locator("[data-connect]").isEnabled(), true);
      await neverEvil(site);
      await site.context.close();
    }
  });

  it("at 5 apps (409) says so, links to Linked apps, and redirects nowhere", async () => {
    const site = await open(asked({ status: 409, body: { error: "too_many_links" } }));
    await press(site.page, "Connect classbeat");
    await site.page.waitForSelector(".plate");
    assert.match(await site.page.locator(".plate").innerText(), /You have linked 5 apps already/);
    assert.equal(await site.page.locator(".plate").getByRole("link", { name: "Linked apps" }).getAttribute("href"), "/account/links");
    assert.equal(await site.page.locator("[data-connect]").count(), 0);
    assert.deepEqual(site.left, []);
    await site.context.close();
  });

  it("sends one approval while one is waiting", async () => {
    const site = await open(asked({ status: 200, hold: true }));
    await press(site.page, "Connect classbeat");
    await site.page.waitForSelector(".status");
    assert.equal(await site.page.locator("[data-connect]").isDisabled(), true);
    await site.page.locator("[data-connect]").click({ force: true });
    await settled(site);
    assert.equal(routes(site).filter((r) => r === "POST source-links/approve").length, 1);
    await site.context.close();
  });

  it("a session that ended goes to Sign in, and nothing is approved", async () => {
    const site = await open(asked({ status: 401, body: { error: "not_signed_in" } }));
    await press(site.page, "Connect classbeat");
    await site.page.waitForSelector("input[name=email]");
    assert.equal(new URL(site.page.url()).pathname, "/sign-in");
    assert.deepEqual(site.left, []);
    await site.context.close();
  });
});
