// Your data for both kinds of account on the fake backend (#505; ADR 0010, section 8): `GET me`
// says whether the account has an email. With one, the deletion asks for it as before; with none
// (`email: null`), it asks for the words "your classbeat account", and the server still decides.
// A body that is not the `me` answer is the server fault. The account's own address, read from
// `GET me`, is never shown, sent, stored or logged in any Your data state, and the no-email states
// keep the same no-storage and no-request rules as the others. Fakes only: no network.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { launchOffline, openSite, settled, traps } from "../lib/site-fake.ts";
import type { FakeSite, Script } from "../lib/site-fake.ts";
import { reach } from "../lib/site-measure.ts";
import { DATA_STATES, ME_EMAIL, SIGNED_IN } from "../lib/site-data-states.ts";
import { NO_EMAIL_ME, NO_EMAIL_STATES, TYPED_WORDS, TYPED_WORDS_WRONG } from "../lib/site-no-email-states.ts";
import { STATES } from "../lib/site-states.ts";

const DELETE = "POST account/delete";
const NO_EMAIL_ASK = "Type “your classbeat account” to confirm.";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const open = async (script: Script, ready = "[data-export]"): Promise<FakeSite> => {
  const site = await openSite(browser, "/account/data", { width: 390, height: 844, script });
  await site.page.waitForSelector(ready);
  return site;
};
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).first().click();
const openPanel = (page: Page): Promise<void> => press(page, "Delete my account…");
const bodies = (site: FakeSite): unknown[] => site.api.filter((a) => a.route === DELETE).map((a) => JSON.parse(a.body ?? "null") as unknown);

describe("the deletion panel, for each kind of account", () => {
  const kinds = [
    { kind: "with an email", script: SIGNED_IN, ask: "Type your email address to confirm.", label: "Your email address", type: "email" },
    { kind: "without an email", script: NO_EMAIL_ME, ask: NO_EMAIL_ASK, label: "Type “your classbeat account”", type: "text" },
  ] as const;
  for (const k of kinds) {
    it(`${k.kind}: reads GET me only, and asks for the right confirmation`, async () => {
      const site = await open(k.script);
      assert.deepEqual(site.api.map((a) => a.route), ["GET me"]);
      await openPanel(site.page);
      const panel = site.page.locator("[role=alertdialog]");
      const text = await panel.innerText();
      assert.ok(text.includes(k.ask), text);
      for (const other of kinds) if (other !== k) assert.ok(!text.includes(other.ask), `${k.kind} shows the other ask`);
      assert.equal(await panel.locator("label").innerText(), k.label);
      const input = panel.locator("input[name=confirm]");
      assert.equal(await input.getAttribute("type"), k.type);
      assert.equal(await input.getAttribute("autocomplete"), "off");
      assert.equal(await input.getAttribute("maxlength"), "254");
      assert.deepEqual(await panel.locator("button").allInnerTexts(), ["Keep my account", "Delete everything"]);
      assert.equal(await site.page.evaluate(() => (document.activeElement?.textContent ?? "").trim()), "Keep my account");
      assert.equal(await site.page.getByRole("button", { name: "Delete everything" }).isDisabled(), true);
      await site.context.close();
    });
  }
});

describe("an account without an email", () => {
  it("sends the words as typed, and 204 goes to 'Your account was deleted'", async () => {
    const site = await open({ ...NO_EMAIL_ME, [DELETE]: { status: 204 } });
    await openPanel(site.page);
    await site.page.locator("input[name=confirm]").fill(TYPED_WORDS);
    await press(site.page, "Delete everything");
    await site.page.waitForSelector(".note");
    assert.deepEqual(bodies(site), [{ confirm: TYPED_WORDS }], "the case is left to the server");
    assert.equal(new URL(site.page.url()).pathname, "/sign-in");
    assert.match(await site.page.locator(".note").innerText(), /Your account was deleted/);
    await site.context.close();
  });

  it("422 confirmation_mismatch is the field error in the words' terms, focus on the field, nothing deleted", async () => {
    const site = await open({ ...NO_EMAIL_ME, [DELETE]: { status: 422, body: { error: "confirmation_mismatch" } } });
    await openPanel(site.page);
    await site.page.locator("input[name=confirm]").fill(TYPED_WORDS_WRONG);
    await site.page.locator("input[name=confirm]").press("Enter");
    await site.page.waitForSelector(".field.err");
    assert.deepEqual(bodies(site), [{ confirm: TYPED_WORDS_WRONG }]);
    assert.equal(await site.page.locator(".field .error").innerText(), "That is not “your classbeat account”. Nothing was deleted.");
    assert.ok(!(await site.page.locator(".ac-panel").innerText()).includes("email address"));
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name ?? ""), "confirm");
    assert.equal(await site.page.inputValue("input[name=confirm]"), TYPED_WORDS_WRONG);
    assert.equal(new URL(site.page.url()).pathname, "/account/data");
    await site.context.close();
  });

  it("Esc keeps the account and drops what was typed", async () => {
    const site = await open(NO_EMAIL_ME);
    await openPanel(site.page);
    await site.page.locator("input[name=confirm]").fill(TYPED_WORDS);
    await site.page.keyboard.press("Escape");
    assert.equal(await site.page.locator("[role=alertdialog]").count(), 0);
    await openPanel(site.page);
    assert.equal(await site.page.inputValue("input[name=confirm]"), "");
    assert.equal(bodies(site).length, 0);
    await site.context.close();
  });
});

describe("a GET me body that is not the me answer", () => {
  for (const body of [{}, { email: 5 }, { email: "" }, { mail: null }, [], "ana@example.com", null]) {
    it(`${JSON.stringify(body)} is the server fault, and nothing else is asked`, async () => {
      const site = await open({ "GET me": { status: 200, body } }, ".plate");
      assert.equal(await site.page.locator("h1").innerText(), "Something went wrong");
      assert.equal(await site.page.locator("input, [data-export], [data-delete-open]").count(), 0);
      assert.deepEqual(site.api.map((a) => a.route), ["GET me"]);
      await site.context.close();
    });
  }
});

describe("the account's own address from GET me is nowhere", () => {
  it("every no-email state is checked by the site checks", () => {
    for (const s of NO_EMAIL_STATES) assert.ok(STATES.includes(s), `${s.name} is not in STATES`);
    assert.ok(DATA_STATES.length >= 10);
  });

  for (const state of [...DATA_STATES, ...NO_EMAIL_STATES]) {
    it(state.name, async () => {
      const site = await reach(browser, { state, width: 390, zoom: 1, ink: false });
      await settled(site);
      const seen = await traps(site.page);
      const markup = await site.page.content();
      const me = site.api.filter((a) => a.route === "GET me");
      assert.equal(me.length, 1, "Your data reads GET me once");
      if (state.script?.["GET me"] === SIGNED_IN["GET me"]) {
        assert.ok(!markup.includes(ME_EMAIL), "the account's address in the page's markup");
        assert.ok(!(await site.page.evaluate(() => document.body.innerText)).includes(ME_EMAIL), "the account's address on screen");
        assert.ok(!site.page.url().includes(ME_EMAIL), "the account's address in the page's address");
        for (const u of site.urls) assert.ok(!decodeURIComponent(u).includes(ME_EMAIL), `the account's address in a request address: ${u}`);
        for (const a of site.api) assert.ok(!(a.body ?? "").includes(ME_EMAIL), `the account's address sent to ${a.route}`);
        for (const t of seen) assert.ok(!t.detail.includes(ME_EMAIL), `the account's address in ${t.kind}: ${t.detail}`);
        for (const c of site.console) assert.ok(!c.includes(ME_EMAIL), `the account's address in the console: ${c}`);
      }
      assert.deepEqual(seen.filter((t) => ["storage", "cookie", "indexeddb", "cache", "console"].includes(t.kind)), []);
      assert.deepEqual(site.unscripted, [], "an API request the state does not expect");
      assert.deepEqual(site.external, [], "a request to another origin");
      assert.deepEqual(site.left, [], "a navigation away");
      for (const a of site.api) assert.equal(new URL(a.url).search, "", `a query on ${a.route}`);
      assert.equal(await site.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await site.context.close();
    });
  }
});
