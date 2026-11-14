// The devices page on the fake backend (docs/design/site.md, "Devices and pairing"; ADR 0002,
// section 6): the list as the backend sends it, and revoking in place with "Keep it" as the
// default, `DELETE devices/{id}` and the "Revoked" note.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { ORIGIN, launchOffline, openSite, settled } from "../lib/site-fake.ts";
import type { FakeSite, Script } from "../lib/site-fake.ts";
import { DEVICES, LISTED } from "../lib/site-device-states.ts";

const FIRST = DEVICES[0];
const DELETE_FIRST = `DELETE devices/${FIRST.id}`;

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const open = async (script: Script = {}, ready = ".dev-item"): Promise<FakeSite> => {
  const site = await openSite(browser, "/devices", { width: 390, height: 844, script: { ...LISTED, ...script }, clock: "day" });
  await site.page.waitForSelector(ready);
  return site;
};
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).first().click();
const active = (page: Page): Promise<string> => page.evaluate(() => (document.activeElement?.textContent ?? "").trim());
const deletes = (site: FakeSite): string[] => site.api.filter((a) => a.method === "DELETE").map((a) => a.route);

describe("the list", () => {
  it("shows each device as the app sent it, in the backend's order, with the count", async () => {
    const site = await open();
    assert.match(await site.page.locator("h1").innerText(), /Devices\s+3 devices/);
    const rows = await site.page.locator(".dev-item").allInnerTexts();
    assert.deepEqual(rows.map((r) => r.split("\n")[0]), ["Studio PC", "Laptop", "Spare computer"]);
    assert.match(rows[0], /Windows, version 0\.4\.0/);
    assert.match(rows[0], /Paired 3 Nov/);
    assert.match(rows[0], /Last used today/);
    assert.match(rows[2], /Not used yet/);
    assert.equal(await site.page.getByRole("link", { name: "Pair a device" }).getAttribute("href"), "/pair");
    await site.context.close();
  });

  it("sets a name as text, never as markup", async () => {
    const odd = { ...FIRST, name: '<img src=x onerror="go()">' };
    const site = await open({ "GET devices": { status: 200, body: { devices: [odd] } } });
    assert.equal(await site.page.locator(".dev-t").first().innerText(), odd.name);
    assert.equal(await site.page.locator("main img").count(), 0);
    await site.context.close();
  });

  it("refuses a body it does not understand: an id that is not a uuid is the server fault", async () => {
    for (const id of ["../sessions", FIRST.id.toUpperCase(), ""]) {
      const site = await open({ "GET devices": { status: 200, body: { devices: [{ ...FIRST, id }] } } }, ".plate");
      assert.equal(await site.page.locator(".dev-item").count(), 0, id);
      await site.context.close();
    }
  });

  it("with no devices, says how to pair one", async () => {
    const site = await open({ "GET devices": { status: 200, body: { devices: [] } } }, "h2");
    assert.equal(await site.page.locator("h2").innerText(), "No devices yet");
    assert.equal(await site.page.getByRole("link", { name: "Enter a code" }).getAttribute("href"), "/pair");
    await site.context.close();
  });
});

describe("revoke", () => {
  it("asks in place, with 'Keep it' first and focused", async () => {
    const site = await open();
    await press(site.page, "Revoke");
    const panel = site.page.locator("[role=alertdialog]");
    assert.match(await panel.innerText(), /Revoke “Studio PC”\?/);
    assert.match(await panel.innerText(), /It stops getting classes at once\. The classes saved on it are removed the next time it connects\./);
    assert.deepEqual(await panel.locator("button").allInnerTexts(), ["Keep it", "Revoke device"]);
    assert.equal(await active(site.page), "Keep it");
    // Enter on the focused default keeps the device.
    await site.page.keyboard.press("Enter");
    assert.equal(await panel.count(), 0);
    assert.deepEqual(deletes(site), []);
    await site.context.close();
  });

  it("Esc cancels and returns focus to the row's 'Revoke'", async () => {
    const site = await open();
    await site.page.locator(".dev-item button").nth(1).click();
    await site.page.keyboard.press("Escape");
    assert.equal(await site.page.locator("[role=alertdialog]").count(), 0);
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.device), DEVICES[1].id);
    assert.deepEqual(deletes(site), []);
    await site.context.close();
  });

  it("sends DELETE devices/{id} and shows the 'Revoked' note and the shortened list", async () => {
    const site = await open({ [DELETE_FIRST]: { status: 204 } });
    await press(site.page, "Revoke");
    await press(site.page, "Revoke device");
    await site.page.waitForSelector(".note");
    assert.deepEqual(deletes(site), [DELETE_FIRST]);
    assert.equal(site.api.find((a) => a.method === "DELETE")?.body, null, "no body");
    assert.match(await site.page.locator(".note").innerText(), /Revoked “Studio PC”/);
    assert.equal(await site.page.evaluate(() => document.activeElement?.classList.contains("note")), true);
    assert.match(await site.page.locator("h1").innerText(), /2 devices/);
    assert.deepEqual((await site.page.locator(".dev-t").allInnerTexts()), ["Laptop", "Spare computer"]);
    await site.context.close();
  });

  it("revoking the last device leaves the note and the empty page", async () => {
    const site = await open({ "GET devices": { status: 200, body: { devices: [FIRST] } }, [DELETE_FIRST]: { status: 204 } });
    await press(site.page, "Revoke");
    await press(site.page, "Revoke device");
    await site.page.waitForSelector(".note");
    assert.equal(await site.page.locator("h2").innerText(), "No devices yet");
    await site.context.close();
  });

  it("one already gone (404) reads the list again", async () => {
    const site = await open({ "GET devices": [{ status: 200, body: { devices: DEVICES } }, { status: 200, body: { devices: DEVICES.slice(1) } }], [DELETE_FIRST]: { status: 404, body: { error: "not_found" } } });
    await press(site.page, "Revoke");
    await press(site.page, "Revoke device");
    await site.page.waitForFunction(() => document.querySelectorAll(".dev-item").length === 2);
    assert.deepEqual(site.api.map((a) => a.route), ["GET devices", DELETE_FIRST, "GET devices"]);
    await site.context.close();
  });

  it("a fault keeps the confirmation open under a plate, and sends nothing again by itself", async () => {
    for (const reply of [{ status: 0, fail: true }, { status: 500, body: { error: "internal" } }, { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "60" } }] as const) {
      const site = await open({ [DELETE_FIRST]: reply });
      await press(site.page, "Revoke");
      await press(site.page, "Revoke device");
      await site.page.waitForSelector(".plate");
      assert.equal(await site.page.locator("[role=alertdialog]").count(), 1);
      assert.equal(await site.page.evaluate(() => document.activeElement?.classList.contains("plate")), true);
      await site.page.evaluate(() => window.dispatchEvent(new Event("online")));
      await settled(site);
      assert.deepEqual(deletes(site), [DELETE_FIRST]);
      await site.context.close();
    }
  });

  it("a session that ended goes to Sign in", async () => {
    const site = await open({ [DELETE_FIRST]: { status: 401, body: { error: "not_signed_in" } } });
    await press(site.page, "Revoke");
    await press(site.page, "Revoke device");
    await site.page.waitForSelector(".note");
    assert.equal(site.page.url(), `${ORIGIN}/sign-in`);
    await site.context.close();
  });
});
