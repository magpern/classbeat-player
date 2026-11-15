// The account Passkeys page on the fake backend (docs/design/site.md, "Account" and "Keyboard";
// ADR 0002, sections 4 and 6): the list, adding one through the browser's prompt (a stand-in,
// site-passkey.ts), renaming and removing in place, the limit of 10, "Confirm it is you" after a
// 403 `recent_sign_in_required`, which sends nothing again by itself and goes to classbeat (ADR
// 0010, section 5), and a 403 `passkeys_closed`, which never asks to confirm (section 7).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { launchOffline, openSite, settled, traps } from "../lib/site-fake.ts";
import type { FakeSite, Passkey, Script } from "../lib/site-fake.ts";
import { AUTHORIZE, CLOSED, NEW_CREDENTIAL, NEW_PASSKEY, PASSKEYS, PASSKEYS_CLOSED, PASSKEYS_LISTED, RECENT, REG_OPTIONS, TEN } from "../lib/site-account-states.ts";

const START = "POST sign-in/classbeat/start";
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
    const site = await open({ "GET passkeys": { status: 200, body: { passkeys: [], can_add: true } } }, { ready: "[data-add]" });
    assert.equal(await site.page.locator(".ac-item").count(), 0);
    assert.equal(await site.page.getByRole("button", { name: "Add a passkey" }).count(), 1);
    await site.context.close();
  });

  it("at the limit, the add button is off and says why", async () => {
    const site = await open({ "GET passkeys": { status: 200, body: { passkeys: TEN, can_add: true } } }, { ready: "[data-add]:disabled" });
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

  it("offline, the form stays under the 'You are offline' plate and the add button points at it", async () => {
    const site = await open({ "POST passkeys/options": { status: 0, fail: true } });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".plate");
    assert.match(await site.page.locator(".plate").innerText(), /You are offline/);
    const why = await site.page.locator("form[data-add] button[type=submit]").getAttribute("aria-describedby");
    assert.ok(why);
    assert.equal(await site.page.locator(".plate").getAttribute("id"), why);
    await site.context.close();
  });

  it("offline, the list's 'Add a passkey' is off under the plate and points at it, until the browser is back online (#441)", async () => {
    const route = `DELETE passkeys/${FIRST.id}`;
    const site = await open({ [route]: [{ status: 0, fail: true }, { status: 204 }] });
    await press(site.page, "Remove");
    await press(site.page, "Remove passkey");
    await site.page.waitForSelector(".plate");
    assert.match(await site.page.locator(".plate").innerText(), /You are offline/);
    const add = site.page.locator("button[data-add]");
    assert.equal(await add.isDisabled(), true, "Add a passkey is off while offline");
    assert.equal(await add.getAttribute("aria-describedby"), await site.page.locator(".plate").getAttribute("id"));
    await add.click({ force: true });
    assert.equal(await site.page.locator("form[data-add]").count(), 0, "a press on the disabled button opens nothing");
    // The remove row stays open, and its button is the way to ask again.
    assert.equal(await site.page.getByRole("button", { name: "Remove passkey", exact: true }).isDisabled(), false);
    // Back online: the plate goes and the button is on again in place; nothing is sent by itself.
    await site.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await site.page.waitForSelector(".plate", { state: "detached" });
    await settled(site);
    assert.equal(sent(site, route), 1, "nothing is sent by itself");
    assert.equal(await add.isDisabled(), false);
    assert.equal(await add.getAttribute("aria-describedby"), null);
    await press(site.page, "Remove passkey");
    await site.page.waitForSelector(".note");
    assert.equal(sent(site, route), 2);
    await site.context.close();
  });

  it("offline, the add form keeps its button on, pointing at the plate, also once back online", async () => {
    const site = await open({ "POST passkeys/options": { status: 0, fail: true } });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".plate");
    await site.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await settled(site);
    const ok = site.page.locator("form[data-add] button[type=submit]");
    assert.equal(await ok.isDisabled(), false);
    assert.equal(await ok.getAttribute("aria-describedby"), await site.page.locator(".plate").getAttribute("id"));
    assert.equal(sent(site, "POST passkeys/options"), 1, "nothing is sent by itself");
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
    const site = await open({ "GET passkeys": [{ status: 200, body: { passkeys: PASSKEYS, can_add: true } }, { status: 200, body: { passkeys: TEN, can_add: true } }], "POST passkeys/options": { status: 409, body: { error: "too_many_passkeys" } } });
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

describe("adding is closed (ADR 0010, section 7)", () => {
  for (const [step, script] of [
    ["the options", { "POST passkeys/options": CLOSED }],
    ["the registration", { ...OPTIONS, "POST passkeys": CLOSED }],
  ] as const) {
    it(`a 403 passkeys_closed from ${step} never asks to confirm it is you`, async () => {
      const site = await open(script);
      await addAs(site, "Tablet");
      await site.page.waitForSelector(".plate");
      const plate = site.page.locator(".plate");
      assert.match(await plate.innerText(), /Passkeys are not available for this account/);
      assert.doesNotMatch(await site.page.locator("main").innerText(), /Confirm it is you|Confirm with classbeat/);
      assert.equal(await site.page.locator("[data-confirm]").count(), 0);
      assert.equal(await plate.locator("button").count(), 0, "nothing to press: no sign-in again can open it");
      assert.equal(await plate.evaluate((e) => e === document.activeElement), true);
      // Not offered again, and nothing is sent again by itself; the list stays.
      assert.equal(await site.page.locator("[data-add], form[data-add]").count(), 0);
      assert.equal(await site.page.locator(".ac-item").count(), 3);
      await settled(site, 600);
      assert.deepEqual(site.api.map((a) => a.route), step === "the options" ? ["GET passkeys", "POST passkeys/options"] : ["GET passkeys", "POST passkeys/options", "POST passkeys"]);
      assert.deepEqual(site.toClassbeat, []);
      await site.context.close();
    });
  }

  it("the passkeys listed stay renamable and removable, and the page still says why there is no 'Add a passkey'", async () => {
    const rename = `PATCH passkeys/${FIRST.id}`;
    const remove = `DELETE passkeys/${PASSKEYS[1].id}`;
    const site = await open({ "POST passkeys/options": CLOSED, [rename]: { status: 200, body: { ...FIRST, name: "Old laptop" } }, [remove]: { status: 204 } });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".plate");
    await press(site.page, "Rename");
    await site.page.fill("input[name=name]", "Old laptop");
    await site.page.keyboard.press("Enter");
    await site.page.waitForFunction(() => document.querySelector(".ac-item")?.textContent?.includes("Old laptop"));
    assert.equal(sent(site, rename), 1);
    await site.page.locator(`[data-row="${PASSKEYS[1].id}"][data-act="remove"]`).click();
    await press(site.page, "Remove passkey");
    await site.page.waitForSelector(".note");
    assert.equal(sent(site, remove), 1);
    assert.equal(await site.page.locator(".ac-item").count(), 2);
    assert.match(await site.page.locator("main").innerText(), /Passkeys are not available for this account\. You sign in with classbeat\./);
    assert.equal(await site.page.locator("[data-add], form[data-add]").count(), 0);
    assert.equal(sent(site, "POST passkeys/options"), 1);
    await site.context.close();
  });
});

describe("closed from the start: GET passkeys says can_add (ADR 0010, section 7)", () => {
  const REASON = "Passkeys are not available for this account. You sign in with classbeat.";
  const noAdd = async (site: FakeSite): Promise<void> => {
    assert.equal(await site.page.locator("[data-add], form[data-add]").count(), 0, "no add action");
    assert.equal(await site.page.getByRole("button", { name: "Add a passkey" }).count(), 0);
    assert.equal(await site.page.getByRole("button", { name: "Try again" }).count(), 0, "no way back into the add form");
  };
  /** The reason line: the hollow square and the two sentences, no box and no role, above the count. */
  const reasonLine = async (site: FakeSite): Promise<void> => {
    const line = site.page.locator(".reason");
    assert.equal(await line.count(), 1);
    assert.equal((await line.innerText()).trim(), REASON);
    assert.equal(await line.locator(".mark.away").count(), 1);
    assert.equal(await line.getAttribute("role"), null);
    assert.equal(await site.page.locator(".plate").count(), 0, "a fact, not a plate");
  };

  it("can_add true offers 'Add a passkey' and no reason line", async () => {
    const site = await open();
    assert.equal(await site.page.getByRole("button", { name: "Add a passkey" }).count(), 1);
    assert.equal(await site.page.locator(".reason").count(), 0);
    assert.doesNotMatch(await site.page.locator("main").innerText(), /email link|always works/i);
    await site.context.close();
  });

  it("can_add false shows the reason line in place of 'Add a passkey', and sends nothing", async () => {
    const site = await open(PASSKEYS_CLOSED, { ready: ".reason" });
    await reasonLine(site);
    await noAdd(site);
    const main = await site.page.locator("main").innerText();
    assert.doesNotMatch(main, /A passkey signs you in|You have no passkeys yet|Confirm it is you/);
    // Where "Add a passkey" would be: above the count and the rows.
    assert.equal(await site.page.locator(".reason + .small").innerText(), "3 of 10 passkeys");
    assert.equal(await site.page.locator(".ac-item").count(), 3);
    await settled(site, 600);
    assert.deepEqual(site.api.map((a) => a.route), ["GET passkeys"]);
    await site.context.close();
  });

  it("can_add false with no passkeys shows the reason line alone", async () => {
    const site = await open({ "GET passkeys": { status: 200, body: { passkeys: [], can_add: false } } }, { ready: ".reason" });
    await reasonLine(site);
    await noAdd(site);
    assert.equal(await site.page.locator(".ac-item").count(), 0);
    assert.doesNotMatch(await site.page.locator("main").innerText(), /You have no passkeys yet/);
    await site.context.close();
  });

  it("can_add false keeps the passkeys renamable and removable, with the reason line after each", async () => {
    const rename = `PATCH passkeys/${FIRST.id}`;
    const remove = `DELETE passkeys/${PASSKEYS[1].id}`;
    const site = await open({ ...PASSKEYS_CLOSED, [rename]: { status: 200, body: { ...FIRST, name: "Old laptop" } }, [remove]: { status: 204 } }, { ready: ".reason" });
    await press(site.page, "Rename");
    await site.page.fill("input[name=name]", "Old laptop");
    await site.page.keyboard.press("Enter");
    await site.page.waitForFunction(() => document.querySelector(".ac-item")?.textContent?.includes("Old laptop"));
    await reasonLine(site);
    await site.page.locator(`[data-row="${PASSKEYS[1].id}"][data-act="remove"]`).click();
    await press(site.page, "Remove passkey");
    await site.page.waitForSelector(".note");
    assert.match(await site.page.locator(".note").innerText(), /You can no longer sign in with it\./);
    assert.doesNotMatch(await site.page.locator(".note").innerText(), /Email links/);
    await reasonLine(site);
    await noAdd(site);
    assert.deepEqual(site.api.map((a) => a.route), ["GET passkeys", rename, remove]);
    await site.context.close();
  });

  for (const [what, body] of [
    ["no can_add", { passkeys: PASSKEYS }],
    ["can_add as a string", { passkeys: PASSKEYS, can_add: "true" }],
    ["can_add null", { passkeys: PASSKEYS, can_add: null }],
    ["a field the schema does not allow", { passkeys: PASSKEYS, can_add: true, kind: "follower" }],
  ] as const) {
    it(`an answer that does not match the schema (${what}) fails closed: no add action`, async () => {
      const site = await open({ "GET passkeys": { status: 200, body } }, { ready: ".reason" });
      await noAdd(site);
      await reasonLine(site);
      assert.equal(await site.page.locator(".ac-item").count(), 3);
      await settled(site, 600);
      assert.deepEqual(site.api.map((a) => a.route), ["GET passkeys"]);
      await site.context.close();
    });
  }

  for (const [how, first, steps] of [
    ["from the start", { passkeys: PASSKEYS, can_add: false }, async (): Promise<void> => {}],
    ["by a 403 passkeys_closed", { passkeys: PASSKEYS, can_add: true }, async (site: FakeSite): Promise<void> => {
      await addAs(site, "Tablet");
      await site.page.waitForSelector(".plate");
    }],
  ] as const) {
    it(`closed ${how}, a list read again that says can_add true does not reopen adding`, async () => {
      const rename = `PATCH passkeys/${FIRST.id}`;
      const again = { status: 200, body: { passkeys: PASSKEYS, can_add: true } };
      const site = await open({ "GET passkeys": [{ status: 200, body: first }, again], "POST passkeys/options": CLOSED, [rename]: { status: 404, body: { error: "not_found" } } });
      await steps(site);
      const options = sent(site, "POST passkeys/options");
      await press(site.page, "Rename");
      await site.page.fill("input[name=name]", "Old laptop");
      await site.page.keyboard.press("Enter");
      // The rename found the passkey gone (404), so the list is read again; that answer says can_add true.
      await site.page.waitForFunction(() => document.querySelector("input[name=name]") === null);
      await settled(site, 600);
      assert.equal(sent(site, "GET passkeys"), 2);
      await noAdd(site);
      await reasonLine(site);
      assert.equal(sent(site, "POST passkeys/options"), options, "no POST passkeys/options after the list is read again");
      await site.context.close();
    });
  }

  it("a list read again that says can_add false closes adding too", async () => {
    const site = await open({ "GET passkeys": [{ status: 200, body: { passkeys: PASSKEYS, can_add: true } }, { status: 200, body: { passkeys: PASSKEYS, can_add: false } }], "POST passkeys/options": { status: 409, body: { error: "too_many_passkeys" } } });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".reason");
    await noAdd(site);
    assert.equal(sent(site, "GET passkeys"), 2);
    await site.context.close();
  });
});

describe("confirm it is you", () => {
  it("after a 403 on adding, nothing is sent again, and 'Confirm with classbeat' starts a re-authentication with no return entry", async () => {
    const site = await open({ "POST passkeys/options": RECENT, [START]: { status: 200, body: { authorize: AUTHORIZE } } });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    const plate = site.page.locator(".plate");
    assert.match(await plate.innerText(), /Confirm it is you/);
    // The email link and passkeys are closed (ADR 0010, section 7): classbeat is the one way.
    assert.deepEqual((await plate.locator("button").allInnerTexts()).map((t) => t.trim()), ["Confirm with classbeat"]);
    await settled(site, 600);
    assert.equal(sent(site, "POST passkeys/options"), 1);
    await press(site.page, "Confirm with classbeat");
    for (let i = 0; i < 200 && site.toClassbeat.length === 0; i += 1) await site.page.waitForTimeout(10);
    assert.deepEqual(site.toClassbeat, [AUTHORIZE]);
    const start = site.api.filter((a) => a.route === START);
    assert.equal(start.length, 1);
    assert.deepEqual(JSON.parse(start[0].body ?? "null"), { purpose: "reauth" });
    await settled(site, 600);
    // Nothing else is sent: the change is made again by hand after classbeat.
    assert.deepEqual(site.api.map((a) => a.route), ["GET passkeys", "POST passkeys/options", START]);
    assert.deepEqual(site.external, []);
    await site.context.close();
  });

  it("a 403 on the registration's second step asks to confirm too", async () => {
    const site = await open({ ...OPTIONS, "POST passkeys": RECENT });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    assert.equal(sent(site, "POST passkeys"), 1);
    await site.context.close();
  });

  it("an authorize address that is not HTTPS is not gone to", async () => {
    const site = await open({ "POST passkeys/options": RECENT, [START]: { status: 200, body: { authorize: "http://classbeat.test/oauth/authorize" } } });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    await press(site.page, "Confirm with classbeat");
    await site.page.waitForSelector(".plate[data-confirm=failed]");
    assert.match(await site.page.locator(".plate").innerText(), /it was not your doing/);
    await settled(site, 300);
    assert.deepEqual(site.toClassbeat, []);
    assert.deepEqual(site.external, []);
    await site.context.close();
  });

  it("offline, says so and offers to try again; a 401 goes to Sign in", async () => {
    const site = await open({ "POST passkeys/options": RECENT, [START]: [{ status: 0, fail: true }, { status: 401, body: { error: "not_signed_in" } }] });
    await addAs(site, "Tablet");
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    await press(site.page, "Confirm with classbeat");
    await site.page.waitForSelector(".plate[data-confirm=failed]");
    assert.match(await site.page.locator(".plate").innerText(), /You are offline/);
    await press(site.page, "Confirm with classbeat");
    await site.page.waitForURL(/\/sign-in$/);
    assert.equal(sent(site, START), 2);
    await site.context.close();
  });
});
