// A signed-in page's first load on the fake backend (src/site/pages/signed-in.ts): offline, it
// waits for the connection once, however often the person presses "Try again" (#257).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { launchOffline, openSite, waitForApi } from "../lib/site-fake.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

describe("a signed-in page offline", () => {
  it("loads once when the connection returns, after several offline answers", async () => {
    const offline = { status: 0, fail: true } as const;
    const loaded = { status: 200, body: { classes: [], next: null } } as const;
    const site = await openSite(browser, "/classes", { width: 390, height: 844, script: { "GET classes": [offline, offline, offline, loaded] } });
    for (let n = 1; n <= 3; n += 1) {
      await waitForApi(site, n);
      await site.page.waitForSelector(".plate");
      if (n < 3) await site.page.getByRole("button", { name: "Try again", exact: true }).click();
    }
    assert.equal(site.api.length, 3);
    await site.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await waitForApi(site, 4);
    await site.page.waitForTimeout(200);
    assert.deepEqual(site.api.map((a) => a.route), ["GET classes", "GET classes", "GET classes", "GET classes"], "one load when back online");
    assert.equal(await site.page.locator(".plate").count(), 0);
    // A second "online" after the load starts nothing.
    await site.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await site.page.waitForTimeout(200);
    assert.equal(site.api.length, 4);
    await site.context.close();
  });
});
