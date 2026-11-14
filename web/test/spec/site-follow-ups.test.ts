// The website follow-ups of issue #426 on the fake backend: the export when the browser refuses the
// file, when its link is revoked and when the page is left meanwhile; the class note after an account
// deletion; the pairing page's offline retry and the name it shows; a refused first request on
// Devices and /pair; the account page's heading keeping focus on first load. Fakes only: no network.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { CLASS_ID, classReply, library, listReply } from "../lib/class-states.ts";
import { launchOffline, openSite, settled } from "../lib/site-fake.ts";
import type { FakeSite, Script } from "../lib/site-fake.ts";
import { EXPORTED, SIGNED_IN, TYPED } from "../lib/site-data-states.ts";
import { FOUND, LISTED, PAIR_CODE } from "../lib/site-device-states.ts";

const EXPORT = "POST account/export";
let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const open = async (path: string, script: Script, ready: string, o: { clock?: boolean } = {}): Promise<FakeSite> => {
  const site = await openSite(browser, path, { width: 390, height: 844, script, ...o });
  await site.page.waitForSelector(ready);
  return site;
};
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).first().click();

interface Seen {
  made: number;
  revoked: number;
}
/** Counts the page's calls to the two object-URL functions, and optionally makes the file's link fail. */
const watchUrls = (page: Page, refuse = false): Promise<void> =>
  page.evaluate((refuseFile) => {
    const seen: Seen = { made: 0, revoked: 0 };
    (window as unknown as { __urls: Seen }).__urls = seen;
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (o: Blob | MediaSource): string => {
      seen.made += 1;
      if (refuseFile) throw new Error("refused");
      return make(o);
    };
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (u: string): void => {
      seen.revoked += 1;
      revoke(u);
    };
  }, refuse);
const urls = (page: Page): Promise<Seen> => page.evaluate(() => (window as unknown as { __urls: Seen }).__urls);

describe("export (#423 N2 to N4)", () => {
  it("shows the error state, not 'Making your export', when the browser refuses the file", async () => {
    const site = await open("/account/data", { ...SIGNED_IN, [EXPORT]: EXPORTED }, "[data-export]");
    await watchUrls(site.page, true);
    await press(site.page, "Download export");
    await site.page.waitForSelector(".plate");
    assert.match(await site.page.locator(".plate").innerText(), /That did not work, and it was not your doing/);
    assert.equal(await site.page.locator(".status").count(), 0, "no longer making the export");
    assert.equal(await site.page.locator("[data-export]").isDisabled(), false, "can ask again");
    await site.context.close();
  });

  it("revokes the link shortly after the click, not at once", async () => {
    const site = await open("/account/data", { ...SIGNED_IN, [EXPORT]: EXPORTED }, "[data-export]", { clock: true });
    await watchUrls(site.page);
    await press(site.page, "Download export");
    await site.page.waitForSelector(".note");
    assert.deepEqual(await urls(site.page), { made: 1, revoked: 0 });
    await site.page.clock.runFor(1000);
    assert.equal((await urls(site.page)).revoked, 0, "still alive a second later");
    await site.page.clock.runFor(30_000);
    assert.deepEqual(await urls(site.page), { made: 1, revoked: 1 });
    await site.context.close();
  });

  for (const how of ["leaving the page", "signing out"]) {
    it(`drops the file without saving when ${how} while it is made`, async () => {
      const site = await open("/account/data", { ...SIGNED_IN, [EXPORT]: { ...EXPORTED, hold: true }, "POST sign-out": { status: 204 } }, "[data-export]");
      await watchUrls(site.page);
      await press(site.page, "Download export");
      await site.page.waitForSelector(".status");
      if (how === "signing out") await site.page.getByRole("button", { name: "Sign out" }).first().click();
      else await site.page.locator(".subnav a", { hasText: "Linked apps" }).click();
      await site.page.waitForFunction(() => !document.querySelector(".status"));
      const before = await urls(site.page).catch(() => null);
      await site.release();
      await settled(site);
      const after = await urls(site.page).catch(() => null);
      assert.deepEqual(after, before, "nothing was handed to the browser");
      assert.ok(after === null || after.made === 0);
      assert.doesNotMatch(await site.page.locator("main").innerText(), /export has started/i);
      await site.context.close();
    });
  }
});

describe("account deletion (#423 N5)", () => {
  it("clears the 'Deleted' class note the list never showed", async () => {
    const script: Script = {
      ...SIGNED_IN,
      [`GET classes/${CLASS_ID}`]: classReply(),
      [`DELETE classes/${CLASS_ID}`]: { status: 204 },
      // The list after the class delete fails, so its note is held; later reads work.
      "GET classes": [{ status: 500, body: { error: "internal" } }, listReply(library())],
      "POST account/delete": { status: 204 },
    };
    const site = await open(`/classes/${CLASS_ID}`, script, ".zrow");
    await press(site.page, "Delete class");
    await press(site.page, "Delete class");
    await site.page.waitForSelector(".plate");
    await site.page.locator("header a[href^='/account']").first().click();
    await site.page.locator(".subnav a", { hasText: "Your data" }).click();
    await press(site.page, "Delete my account…");
    await site.page.locator("input[name=confirm]").fill(TYPED);
    await press(site.page, "Delete everything");
    await site.page.waitForURL(/\/sign-in$/);
    // Back through Your data and Sessions to the class list, as the same browser would.
    for (let n = 0; n < 3; n += 1) await site.page.goBack();
    await site.page.waitForSelector(".rows .row");
    assert.equal(await site.page.locator(".note").count(), 0, "the note of the earlier account's class is gone");
    await site.context.close();
  });
});

describe("devices and pairing (#420)", () => {
  it("does not break the code at its hyphen", async () => {
    const site = await open("/pair", { ...SIGNED_IN, "POST pairing/find": FOUND }, "input[name=code]");
    await site.page.fill("input[name=code]", PAIR_CODE);
    await press(site.page, "Continue");
    await site.page.waitForSelector(".dev-codebox");
    assert.equal(await site.page.locator(".dev-codebox").evaluate((e) => getComputedStyle(e).whiteSpace), "nowrap");
    await site.context.close();
  });

  it("the offline retry leaves text typed meanwhile alone, and still retries an unchanged code", async () => {
    const offline = { status: 0, fail: true } as const;
    const site = await open("/pair", { ...SIGNED_IN, "POST pairing/find": [offline, FOUND] }, "input[name=code]");
    await site.page.fill("input[name=code]", PAIR_CODE);
    await press(site.page, "Continue");
    await site.page.waitForSelector(".plate");
    await site.page.fill("input[name=code]", "BCDF-GHJL");
    await site.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await settled(site);
    assert.equal(site.api.filter((a) => a.route === "POST pairing/find").length, 1, "nothing sent again");
    assert.equal(await site.page.inputValue("input[name=code]"), "BCDF-GHJL", "what was typed is kept");
    await site.context.close();
    const same = await open("/pair", { ...SIGNED_IN, "POST pairing/find": [offline, FOUND] }, "input[name=code]");
    await same.page.fill("input[name=code]", PAIR_CODE);
    await press(same.page, "Continue");
    await same.page.waitForSelector(".plate");
    await same.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await same.page.waitForSelector(".dev-codebox");
    await same.context.close();
  });

  it("the Paired note shows the name the backend answered", async () => {
    const decide = { status: 200, body: { status: "approved", name: "Studio PC (2)" } } as const;
    const site = await open("/pair", { ...SIGNED_IN, "POST pairing/find": FOUND, "POST pairing/decide": decide }, "input[name=code]");
    await site.page.fill("input[name=code]", PAIR_CODE);
    await press(site.page, "Continue");
    await site.page.waitForSelector(".dev-codebox");
    await site.page.fill("input[name=name]", "Studio PC");
    await press(site.page, "Pair this device");
    await site.page.waitForSelector(".note");
    assert.match(await site.page.locator(".note").innerText(), /“Studio PC \(2\)” is paired/);
    await site.context.close();
  });
});

describe("a refused first request (#419 r2, r3)", () => {
  for (const [path, route] of [["/devices", "GET devices"], ["/pair", "GET sessions"], ["/account/data", "GET sessions"]] as const) {
    for (const status of [403, 404]) {
      it(`${path} answers ${status} with the server fault, and nothing else is asked`, async () => {
        const site = await open(path, { [route]: { status, body: { error: status === 403 ? "forbidden" : "not_found" } } }, ".plate");
        assert.equal(await site.page.locator("h1").innerText(), "Something went wrong");
        assert.equal(await site.page.locator("input, [data-export], .dev-item").count(), 0, "no form or list of the page itself");
        assert.deepEqual(site.api.map((a) => a.route), [route]);
        await site.context.close();
      });
    }
  }
});

describe("the account page heading (#419 r2, r3)", () => {
  it("keeps the focus on first load when it was opened from the header", async () => {
    const site = await open("/classes", { ...SIGNED_IN, "GET classes": listReply(library()), ...LISTED }, ".rows .row");
    await site.page.locator("header a[href^='/account']").first().click();
    await site.page.waitForSelector(".subnav");
    assert.equal(await site.page.evaluate(() => document.activeElement?.tagName), "H1");
    assert.equal(await site.page.evaluate(() => document.activeElement?.textContent), "Account");
    await site.context.close();
  });
});
