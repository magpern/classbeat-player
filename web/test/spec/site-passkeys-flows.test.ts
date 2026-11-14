// The account Passkeys page on the fake backend (docs/design/site.md, "Account" and "Keyboard";
// ADR 0002, sections 4 and 6): the list, adding one through the browser's prompt (a stand-in,
// site-passkey.ts), renaming and removing in place, the limit of 10, and "Confirm it is you"
// after a 403, which sends nothing again by itself.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { launchOffline, openSite, settled, traps } from "../lib/site-fake.ts";
import type { FakeSite, Passkey, Script } from "../lib/site-fake.ts";
import { NEW_CREDENTIAL, NEW_PASSKEY, PASSKEYS, PASSKEYS_LISTED, RECENT, REG_OPTIONS, TEN } from "../lib/site-account-states.ts";
import { PASSKEY_OPTIONS } from "../lib/site-states.ts";

const FIRST = PASSKEYS[0];
const OPTIONS: Script = { "POST passkeys/options": { status: 200, body: REG_OPTIONS } };
const ADDED = { status: 201, body: NEW_PASSKEY } as const;

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const open = async (script: Script = {}, o: { ready?: string; passkey?: Passkey; path?: string } = {}): Promise<FakeSite> => {
  const site = await openSite(browser, o.path ?? "/account/passkeys", { width: 390, height: 844, script: { ...PASSKEYS_LISTED, ...script }, passkey: o.passkey, clock: "day" });
  await site.page.waitForSelector(o.ready ?? ".ac-item");
  return site;
};
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).first().click();
const active = (page: Page): Promise<string> => page.evaluate(() => (document.activeElement?.textContent ?? "").trim());
const sent = (site: FakeSite, route: string): number => site.api.filter((a) => a.route === route).length;
const addAs = async (site: FakeSite, name: string): Promise<void> => {
  await press(site.page, "Add a passkey");
  await site.page.fill("input[name=name]", name);
  await press(site.page, "Add passkey");
};

describe("the list", () => {
  it("shows each passkey in the backend's order, with the count", async () => {
    const site = await open();
    const rows = await site.page.locator(".ac-item").allInnerTexts();
    assert.deepEqual(rows.map((r) => r.split("\n")[0].trim()), ["Laptop", "Phone", "Work computer"]);
    assert.match(await site.page.locator("main").innerText(), /3 of 10 passkeys/);
    assert.deepEqual((await site.page.locator(".ac-item").first().locator("button").allInnerTexts()).map((t) => t.trim()), ["Rename", "Remove"]);
    await site.context.close();
  });

  it("with none, says so and offers 'Add a passkey'", async () => {
    const site = await open({ "GET passkeys": { status: 200, body: { passkeys: [] } } }, { ready: "[data-add]" });
    assert.equal(await site.page.locator(".ac-item").count(), 0);
    assert.equal(await site.page.getByRole("button", { name: "Add a passkey" }).count(), 1);
    await site.context.close();
  });

  it("at the limit, the add button is off and says why", async () => {
    const site = await open({ "GET passkeys": { status: 200, body: { passkeys: TEN } } }, { ready: "[data-add]:disabled" });
    const add = site.page.locator("[data-add]");
    const why = await add.getAttribute("aria-describedby");
    assert.ok(why);
    assert.match(await site.page.locator(`#${why}`).innerText(), /You have 10 passkeys/);
    await site.context.close();
  });

  it("refuses a body it does not understand", async () => {
    const site = await open({ "GET passkeys": { status: 200, body: { passkeys: [{ ...FIRST, id: "../sessions" }] } } }, { ready: ".plate" });
    assert.equal(await site.page.locator(".ac-item").count(), 0);
    await site.context.close();
  });
});

describe("adding a passkey", () => {
  it("asks the browser with the backend's options and sends the attestation with the name", async () => {
    const site = await open({ ...OPTIONS, "POST passkeys": ADDED });
    await addAs(site, "  Tablet ");
    await site.page.waitForSelector(".note");
    assert.match(await site.page.locator(".note").innerText(), /Passkey added/);
    assert.equal(await site.page.locator(".note").evaluate((e) => e === document.activeElement || e.contains(document.activeElement)), true);
    assert.deepEqual(site.api.map((a) => a.route), ["GET passkeys", "POST passkeys/options", "POST passkeys"]);
    const body = JSON.parse(site.api[2].body ?? "{}") as { name: string; credential: Record<string, unknown> };
    assert.equal(body.name, "Tablet");
    assert.deepEqual(body.credential, {
      id: NEW_CREDENTIAL.id,
      rawId: NEW_CREDENTIAL.rawId,
      type: "public-key",
      response: { clientDataJSON: NEW_CREDENTIAL.clientDataJSON, attestationObject: NEW_CREDENTIAL.attestationObject, transports: ["internal", "hybrid"] },
      authenticatorAttachment: "platform",
    });
    const prompt = (await traps(site.page)).filter((t) => t.kind === "passkey").map((t) => t.detail);
    assert.equal(prompt.length, 1);
    assert.match(prompt[0], /^create challenge=32,33,.*,63 user=96,.*,127 exclude=1 rk=required uv=required rp=site\.test$/);
    assert.equal((await site.page.locator(".ac-item").allInnerTexts()).at(-1)?.split("\n")[0].trim(), "Tablet");
    await site.context.close();
  });

  it("checks the name first and sends nothing for an empty one", async () => {
    const site = await open();
    await addAs(site, "   ");
    await site.page.waitForSelector(".field.err");
    assert.equal(sent(site, "POST passkeys/options"), 0);
    await site.context.close();
  });

  it("Esc and Cancel close the form and return focus to 'Add a passkey'", async () => {
    const site = await open();
    await press(site.page, "Add a passkey");
    await site.page.keyboard.press("Escape");
    assert.equal(await site.page.locator("[data-add] input, form[data-add]").count(), 0);
    assert.equal(await active(site.page), "Add a passkey");
    await press(site.page, "Add a passkey");
    await press(site.page, "Cancel");
    assert.equal(await active(site.page), "Add a passkey");
    await site.context.close();
  });

  it("a busy answer is sent once more after the wait, then no more", async () => {
    const busy = { status: 429, body: { error: "busy" }, headers: { "Retry-After": "1" } };
    const site = await open({ ...OPTIONS, "POST passkeys": [busy, ADDED] });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".note", { timeout: 5000 });
    const posts = site.api.filter((a) => a.route === "POST passkeys");
    assert.equal(posts.length, 2);
    assert.equal(posts[0].body, posts[1].body);
    assert.ok(posts[1].at - posts[0].at >= 900);
    await site.context.close();
  });

  it("a cancelled prompt shows 'Not added' with 'Try again', which reopens the form with the name", async () => {
    const site = await open(OPTIONS, { passkey: "cancel" });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".plate");
    assert.equal(sent(site, "POST passkeys"), 0);
    assert.equal(await site.page.locator("[data-add]").count(), 0);
    await press(site.page, "Try again");
    assert.equal(await site.page.inputValue("input[name=name]"), "Tablet");
    await site.context.close();
  });

  it("a refused attestation is 'Not added' too", async () => {
    const site = await open({ ...OPTIONS, "POST passkeys": { status: 400, body: { error: "passkey_refused" } } });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".plate");
    assert.equal(sent(site, "POST passkeys"), 1);
    await site.context.close();
  });

  it("at the limit by the time it is sent, reads the list again", async () => {
    const site = await open({ "GET passkeys": [{ status: 200, body: { passkeys: PASSKEYS } }, { status: 200, body: { passkeys: TEN } }], "POST passkeys/options": { status: 409, body: { error: "too_many_passkeys" } } });
    await addAs(site, "Tablet");
    await site.page.waitForSelector("[data-add]:disabled");
    assert.equal(sent(site, "GET passkeys"), 2);
    await site.context.close();
  });
});

describe("rename", () => {
  it("edits in place, sends the name and returns focus to that row's Rename", async () => {
    const route = `PATCH passkeys/${FIRST.id}`;
    const site = await open({ [route]: { status: 200, body: { ...FIRST, name: "Old laptop" } } });
    await press(site.page, "Rename");
    assert.equal(await site.page.inputValue("input[name=name]"), "Laptop");
    await site.page.fill("input[name=name]", "Old laptop");
    await site.page.keyboard.press("Enter");
    await site.page.waitForFunction(() => document.querySelector(".ac-item")?.textContent?.includes("Old laptop"));
    assert.deepEqual(JSON.parse(site.api.find((a) => a.route === route)?.body ?? "{}"), { name: "Old laptop" });
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.row ?? ""), FIRST.id);
    await site.context.close();
  });

  it("Esc cancels and returns focus to Rename", async () => {
    const site = await open();
    await press(site.page, "Rename");
    await site.page.keyboard.press("Escape");
    assert.equal(await site.page.locator("input[name=name]").count(), 0);
    assert.equal(await active(site.page), "Rename");
    assert.equal(site.api.filter((a) => a.method === "PATCH").length, 0);
    await site.context.close();
  });
});

describe("remove", () => {
  it("asks in place with 'Keep it' first and focused; Enter keeps it, Esc too", async () => {
    const site = await open();
    await press(site.page, "Remove");
    const panel = site.page.locator("[role=alertdialog]");
    assert.match(await panel.innerText(), /Remove “Laptop”\?/);
    assert.deepEqual((await panel.locator("button").allInnerTexts()).map((t) => t.trim()), ["Keep it", "Remove passkey"]);
    assert.equal(await active(site.page), "Keep it");
    await site.page.keyboard.press("Enter");
    assert.equal(await panel.count(), 0);
    await press(site.page, "Remove");
    await site.page.keyboard.press("Escape");
    assert.equal(await panel.count(), 0);
    assert.equal(await active(site.page), "Remove");
    assert.equal(site.api.filter((a) => a.method === "DELETE").length, 0);
    await site.context.close();
  });

  it("removes it, shows the note and moves focus to the next row", async () => {
    const route = `DELETE passkeys/${FIRST.id}`;
    const site = await open({ [route]: { status: 204 } });
    await press(site.page, "Remove");
    await press(site.page, "Remove passkey");
    await site.page.waitForSelector(".note");
    assert.match(await site.page.locator(".note").innerText(), /Removed “Laptop”/);
    assert.equal(await site.page.locator(".ac-item").count(), 2);
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.row ?? ""), PASSKEYS[1].id);
    await site.context.close();
  });

  it("a 403 asks to confirm it is you and is not sent again by itself", async () => {
    const route = `DELETE passkeys/${FIRST.id}`;
    const site = await open({ [route]: RECENT });
    await press(site.page, "Remove");
    await press(site.page, "Remove passkey");
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    await settled(site, 600);
    assert.equal(sent(site, route), 1);
    assert.equal(await site.page.locator(".ac-item").count(), 3);
    await site.context.close();
  });
});

describe("confirm it is you", () => {
  it("after a 403 on adding, nothing is sent again, and a passkey confirms in place", async () => {
    const site = await open({ "POST passkeys/options": RECENT, "POST sign-in/passkey/options": { status: 200, body: PASSKEY_OPTIONS }, "POST sign-in/passkey": { status: 200, body: { status: "signed_in" } } });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    const plate = site.page.locator(".plate");
    assert.match(await plate.innerText(), /Confirm it is you/);
    assert.deepEqual((await plate.locator("button").allInnerTexts()).map((t) => t.trim()), ["Use a passkey", "Email me a link"]);
    await settled(site, 600);
    assert.equal(sent(site, "POST passkeys/options"), 1);
    await press(site.page, "Use a passkey");
    await site.page.waitForSelector(".note");
    assert.match(await site.page.locator(".note").innerText(), /You signed in again/);
    // Signed in again, the person makes the change again themselves: it is not sent by itself.
    await settled(site, 600);
    assert.deepEqual(site.api.map((a) => a.route), ["GET passkeys", "POST passkeys/options", "POST sign-in/passkey/options", "POST sign-in/passkey", "GET passkeys"]);
    await site.context.close();
  });

  it("without passkeys in the browser, offers the link only", async () => {
    const site = await open({ [`DELETE passkeys/${FIRST.id}`]: RECENT }, { passkey: "absent" });
    await press(site.page, "Remove");
    await press(site.page, "Remove passkey");
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    assert.deepEqual((await site.page.locator(".plate button").allInnerTexts()).map((t) => t.trim()), ["Email me a link"]);
    await site.context.close();
  });

  it("'Email me a link' goes to Sign in and comes back to the page once signed in", async () => {
    const site = await open({ "POST passkeys/options": RECENT, "POST sign-in/passkey/options": { status: 200, body: PASSKEY_OPTIONS }, "POST sign-in/passkey": { status: 200, body: { status: "signed_in" } } });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    await press(site.page, "Email me a link");
    await site.page.waitForURL(/\/sign-in$/);
    await press(site.page, "Sign in with a passkey");
    await site.page.waitForURL(/\/account\/passkeys$/);
    await site.page.waitForSelector(".ac-item");
    assert.equal(sent(site, "POST passkeys/options"), 1);
    await site.context.close();
  });
});
