// Pairing a device on the fake backend (ADR 0002, section 6, step 3; docs/design/site.md,
// "Devices and pairing"): the code is typed and never read from the address, "not a code" is
// the local check or the route's 422, every refusal is one answer and the page counts no tries,
// nothing is approved without a press, and the code is never written to storage, the address bar
// or a log.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { ORIGIN, launchOffline, openSite, settled, traps, waitForApi } from "../lib/site-fake.ts";
import type { FakeSite, Script } from "../lib/site-fake.ts";
import { FOUND, LISTED, PAIR_CODE, PAIR_LETTERS } from "../lib/site-device-states.ts";

const SIGNED_IN: Script = { "GET sessions": { status: 200, body: { sessions: [] } } };
const NOT_FOUND = { status: 404, body: { error: "pairing_not_found" } } as const;

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const open = async (script: Script, path = "/pair", width = 390): Promise<FakeSite> => {
  const site = await openSite(browser, path, { width, height: 844, script: { ...SIGNED_IN, ...script } });
  await site.page.waitForSelector("input[name=code]");
  return site;
};
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).click();
const typeCode = async (page: Page, typed: string): Promise<void> => {
  await page.fill("input[name=code]", typed);
  await press(page, "Continue");
};
const finds = (site: FakeSite): (string | null)[] => site.api.filter((a) => a.route === "POST pairing/find").map((a) => a.body);
const decides = (site: FakeSite): (string | null)[] => site.api.filter((a) => a.route === "POST pairing/decide").map((a) => a.body);
const plateText = (page: Page): Promise<string> => page.locator(".plate").innerText();

async function toFound(script: Script = {}): Promise<FakeSite> {
  const site = await open({ "POST pairing/find": FOUND, ...script });
  await typeCode(site.page, PAIR_CODE);
  await site.page.waitForSelector(".dev-codebox");
  return site;
}

describe("the code is typed (ADR 0002, section 6, step 2)", () => {
  it("is never read from the address", async () => {
    const site = await open({}, `/pair?code=${PAIR_LETTERS}&user_code=${PAIR_CODE}#${PAIR_CODE}`);
    await settled(site);
    assert.equal(await site.page.inputValue("input[name=code]"), "");
    assert.deepEqual(site.api.map((a) => a.route), ["GET sessions"]);
    await site.context.close();
  });

  it("ignores dashes, spaces and case, and sends the eight letters", async () => {
    for (const typed of ["bcdf-ghjk", "BCDF GHJK", "bCdFgHjK", " b-c d-f g h j k "]) {
      const site = await open({ "POST pairing/find": FOUND });
      await typeCode(site.page, typed);
      await site.page.waitForSelector(".dev-codebox");
      assert.deepEqual(finds(site), [JSON.stringify({ code: PAIR_LETTERS })], typed);
      assert.equal(await site.page.locator(".dev-codebox").innerText(), PAIR_CODE, "shown in the BCDF-GHJK style");
      await site.context.close();
    }
  });

  it("is shown in the number face, 32 px in the field and 44 px to compare", async () => {
    const site = await toFound();
    assert.equal(await site.page.locator(".dev-codebox").evaluate((e) => getComputedStyle(e).fontSize), "44px");
    assert.match(await site.page.locator(".dev-codebox").evaluate((e) => getComputedStyle(e).fontFamily), /^"Big Shoulders Display"/);
    await site.context.close();
    const enter = await open({});
    const input = enter.page.locator("input[name=code]");
    assert.equal(await input.evaluate((e) => getComputedStyle(e).fontSize), "32px");
    assert.match(await input.evaluate((e) => getComputedStyle(e).fontFamily), /^"Big Shoulders Display"/);
    assert.equal(await input.getAttribute("autocomplete"), "off", "kept out of the browser's form history");
    await enter.context.close();
  });

  it("continues with Enter in the field, without leaving the page", async () => {
    const site = await open({ "POST pairing/find": FOUND });
    await site.page.fill("input[name=code]", PAIR_CODE);
    await site.page.focus("input[name=code]");
    await site.page.keyboard.press("Enter");
    await site.page.waitForSelector(".dev-codebox");
    assert.equal(site.page.url(), `${ORIGIN}/pair`);
    assert.equal(finds(site).length, 1);
    await site.context.close();
  });
});

describe("not a code", () => {
  it("is refused at once by the local check, with no request", async () => {
    const site = await open({});
    for (const typed of ["", "BCDF-GH", "BCDF-GHJKL", "ABCD-EFGH", "BCDF-GHJ1", "BCDF_GHJK", "ＢCDF-GHJK", "BCDF GHJK", "ſCDF-GHJK", `${PAIR_CODE}${" ".repeat(40)}`]) {
      await typeCode(site.page, typed);
      await site.page.waitForSelector(".field.err");
      assert.match(await site.page.locator(".field.err .error").innerText(), /That is not a pairing code\. A code has eight letters\./, typed);
      assert.equal(await site.page.evaluate(() => document.activeElement?.getAttribute("name")), "code", "focus stays in the field");
      assert.equal(await site.page.inputValue("input[name=code]"), typed, "the typed text is kept");
    }
    assert.deepEqual(finds(site), []);
    await site.context.close();
  });

  it("is also the route's 422", async () => {
    const site = await open({ "POST pairing/find": { status: 422, body: { error: "invalid_code" } } });
    await typeCode(site.page, PAIR_CODE);
    await site.page.waitForSelector(".field.err");
    assert.equal(finds(site).length, 1);
    await site.context.close();
  });
});

describe("code not found", () => {
  it("is one answer for every refusal, and the page counts no tries", async () => {
    const site = await open({ "POST pairing/find": NOT_FOUND });
    const seen: string[] = [];
    const codes = ["BCDF-GHJL", "BCDF-GHJM", "BCDF-GHJN", "BCDF-GHJP", "BCDF-GHJQ", "BCDF-GHJR", "BCDF-GHJS"];
    for (const [i, typed] of codes.entries()) {
      await typeCode(site.page, typed);
      await waitForApi(site, i + 2);
      await site.page.waitForSelector(".plate");
      seen.push(await plateText(site.page));
      assert.equal(await site.page.locator("button[type=submit]").isEnabled(), true, "the page never closes the form itself");
    }
    assert.equal(finds(site).length, codes.length, "every try is sent: the route decides");
    assert.equal(new Set(seen).size, 1);
    assert.match(seen[0], /That code was not found/);
    assert.match(seen[0], /after 10 minutes/);
    assert.match(seen[0], /five wrong codes in a row this page closes for 15 minutes/);
    await site.context.close();
  });

  it("is the same answer when the decision finds the pairing gone", async () => {
    const lookup = await open({ "POST pairing/find": NOT_FOUND });
    await typeCode(lookup.page, PAIR_CODE);
    await lookup.page.waitForSelector(".plate");
    const atFind = await plateText(lookup.page);
    await lookup.context.close();
    for (const approve of [true, false]) {
      const site = await toFound({ "POST pairing/decide": NOT_FOUND });
      await press(site.page, approve ? "Pair this device" : "Not this one");
      await site.page.waitForSelector(".plate");
      assert.equal(await plateText(site.page), atFind);
      await site.context.close();
    }
  });
});

describe("found: nothing is approved without a press", () => {
  it("shows who asks, the code and the prefilled name, and waits", async () => {
    const site = await toFound();
    assert.equal(await site.page.evaluate(() => document.activeElement?.tagName), "H1", "focus on the heading, never on a button");
    assert.match(await site.page.locator(".dev-facts").innerText(), /macOS, version 0\.4\.0/);
    assert.equal(await site.page.inputValue("input[name=name]"), "macOS computer");
    await site.page.waitForTimeout(400);
    // Enter in the name field approves nothing.
    await site.page.focus("input[name=name]");
    await site.page.keyboard.press("Enter");
    await site.page.waitForTimeout(200);
    assert.deepEqual(decides(site), []);
    assert.equal(await site.page.locator(".dev-codebox").count(), 1, "still asking");
    await site.context.close();
  });

  for (const width of [390, 1280]) {
    it(`offers "Pair this device" and "Not this one" equally at ${width} px`, async () => {
      const site = await open({ "POST pairing/find": FOUND }, "/pair", width);
      await typeCode(site.page, PAIR_CODE);
      await site.page.waitForSelector(".dev-codebox");
      const box = async (name: string) => (await site.page.getByRole("button", { name, exact: true }).boundingBox())!;
      const [pair, deny] = [await box("Pair this device"), await box("Not this one")];
      assert.equal(Math.round(pair.height), Math.round(deny.height));
      if (width === 390) assert.equal(Math.round(pair.width), Math.round(deny.width), "both full width");
      assert.ok(Math.abs(pair.y - deny.y) < 80, "side by side or one under the other");
      // Both are reached from the keyboard, the safe one right after the other.
      await site.page.focus("input[name=name]");
      await site.page.keyboard.press("Tab");
      assert.equal(await site.page.evaluate(() => document.activeElement?.textContent), "Pair this device");
      await site.page.keyboard.press("Tab");
      assert.equal(await site.page.evaluate(() => document.activeElement?.textContent), "Not this one");
      await site.context.close();
    });
  }

  it("approves with the name on a press, and says so", async () => {
    const site = await toFound({ "POST pairing/decide": { status: 200, body: { status: "approved" } } });
    await site.page.fill("input[name=name]", "  Studio PC ");
    await press(site.page, "Pair this device");
    await site.page.waitForSelector(".note");
    assert.deepEqual(decides(site), [JSON.stringify({ code: PAIR_LETTERS, approve: true, name: "Studio PC" })]);
    assert.match(await site.page.locator(".note").innerText(), /“Studio PC” is paired/);
    assert.equal(await site.page.evaluate(() => document.activeElement?.classList.contains("note")), true);
    await site.context.close();
  });

  it("refuses on a press of 'Not this one', sending no name", async () => {
    const site = await toFound({ "POST pairing/decide": { status: 200, body: { status: "denied" } } });
    await press(site.page, "Not this one");
    await site.page.waitForSelector(".note");
    assert.deepEqual(decides(site), [JSON.stringify({ code: PAIR_LETTERS, approve: false })]);
    assert.match(await site.page.locator(".note").innerText(), /Nothing was paired/);
    await site.context.close();
  });

  it("sends one decision for a double press", async () => {
    const site = await toFound({ "POST pairing/decide": { status: 200, hold: true } });
    const pair = site.page.getByRole("button", { name: "Pair this device", exact: true });
    await pair.click();
    await site.page.waitForSelector(".status");
    assert.equal(await pair.isDisabled(), true);
    assert.equal(await site.page.getByRole("button", { name: "Not this one", exact: true }).isDisabled(), true);
    assert.equal(decides(site).length, 1);
    await site.release();
    await site.context.close();
  });
});

describe("the name", () => {
  it("needs 1 to 40 characters, checked before anything is sent", async () => {
    const site = await toFound();
    for (const name of ["", "   ", "x".repeat(41)]) {
      await site.page.fill("input[name=name]", name);
      await press(site.page, "Pair this device");
      await site.page.waitForSelector(".field.err");
      assert.match(await site.page.locator(".field.err .error").innerText(), /A name needs 1 to 40 characters/);
      assert.equal(await site.page.evaluate(() => document.activeElement?.getAttribute("name")), "name");
    }
    assert.deepEqual(decides(site), []);
    await site.context.close();
  });

  it("not valid by the route's 422 is the same field error", async () => {
    const site = await toFound({ "POST pairing/decide": { status: 422, body: { error: "invalid_name" } } });
    await site.page.fill("input[name=name]", "Studio​ PC");
    await press(site.page, "Pair this device");
    await site.page.waitForSelector(".field.err");
    assert.match(await site.page.locator(".field.err .error").innerText(), /A name needs 1 to 40 characters/);
    assert.equal(await site.page.inputValue("input[name=name]"), "Studio​ PC", "the typed name is kept");
    await site.context.close();
  });
});

describe("refusals and errors", () => {
  it("too many devices (409): the plate and a way to the devices", async () => {
    const site = await toFound({ "POST pairing/decide": { status: 409, body: { error: "too_many_devices" } } });
    await press(site.page, "Pair this device");
    await site.page.waitForSelector(".plate");
    assert.match(await plateText(site.page), /You have 10 devices already/);
    assert.equal(await site.page.locator(".plate a.btn").getAttribute("href"), "/devices");
    assert.equal(await site.page.locator(".dev-codebox").count(), 0, "the request is not offered again");
    await site.context.close();
  });

  it("a fault while deciding keeps the question, with no retry that would decide by itself", async () => {
    for (const reply of [{ status: 503, body: { error: "unavailable" } }, { status: 0, fail: true }, { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "120" } }] as const) {
      const site = await toFound({ "POST pairing/decide": reply });
      await press(site.page, "Pair this device");
      await site.page.waitForSelector(".plate");
      assert.equal(await site.page.locator(".plate button").count(), 0);
      assert.equal(await site.page.locator(".dev-codebox").count(), 1);
      await site.page.evaluate(() => window.dispatchEvent(new Event("online")));
      await site.page.waitForTimeout(200);
      assert.equal(decides(site).length, 1, "nothing is sent again without a press");
      await site.context.close();
    }
  });

  it("a fault while looking up offers 'Try again', which looks the same code up", async () => {
    const site = await open({ "POST pairing/find": [{ status: 0, fail: true }, FOUND] });
    await typeCode(site.page, PAIR_CODE);
    await site.page.waitForSelector(".plate");
    assert.match(await plateText(site.page), /You are offline/);
    await press(site.page, "Try again");
    await site.page.waitForSelector(".dev-codebox");
    assert.deepEqual(finds(site), [JSON.stringify({ code: PAIR_LETTERS }), JSON.stringify({ code: PAIR_LETTERS })]);
    await site.context.close();
  });

  it("a session that ended goes to Sign in, and the code goes nowhere", async () => {
    const site = await open({ "POST pairing/find": { status: 401, body: { error: "not_signed_in" } } });
    await typeCode(site.page, PAIR_CODE);
    await site.page.waitForSelector(".note");
    assert.equal(site.page.url(), `${ORIGIN}/sign-in`);
    assert.equal(await site.page.inputValue("input[name=email]"), "");
    await site.context.close();
  });
});

describe("the code is never written to storage, the address bar or a log", () => {
  it("through a whole pairing", async () => {
    const site = await toFound({ ...LISTED, "POST pairing/decide": { status: 200, body: { status: "approved" } } });
    await press(site.page, "Pair this device");
    await site.page.waitForSelector(".note");
    await site.page.getByRole("link", { name: "See your devices" }).click();
    await site.page.waitForSelector(".dev-item");
    await settled(site);
    const forms = [PAIR_LETTERS, PAIR_CODE, PAIR_LETTERS.toLowerCase(), "BCDF GHJK"];
    const seen = await traps(site.page);
    assert.deepEqual(seen.filter((t) => ["storage", "cookie", "indexeddb", "cache", "console"].includes(t.kind)), []);
    for (const t of seen) for (const f of forms) assert.ok(!t.detail.includes(f), `the code in ${t.kind}: ${t.detail}`);
    for (const u of [site.page.url(), ...site.urls]) for (const f of forms) assert.ok(!u.includes(f), `the code in ${u}`);
    for (const c of site.console) for (const f of forms) assert.ok(!c.includes(f), "the code in the console");
    for (const a of site.api) {
      assert.equal(new URL(a.url).search, "", a.route);
      if (!["POST pairing/find", "POST pairing/decide"].includes(a.route)) for (const f of forms) assert.ok(!(a.body ?? "").includes(f), `the code sent to ${a.route}`);
    }
    // The history entries hold no state with it either.
    assert.equal(await site.page.evaluate(() => JSON.stringify(history.state)), "null");
    assert.equal(await site.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await site.context.close();
  });
});
