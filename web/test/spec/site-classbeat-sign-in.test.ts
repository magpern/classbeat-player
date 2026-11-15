// Signing in with classbeat on the fake backend (#511; docs/design/site.md, "Sign in"; ADR 0010,
// sections 2, 5 and 6): the one start body, `sign_in` and nothing else, the address the page goes to,
// what `/sign-in#error=classbeat` shows for each answer of `GET me`, and the account "Opening
// classbeat…" row. The states themselves are in site-classbeat-states.ts, where the S1 to S12
// checks, the screenshots and "nothing secret leaves the page" run on each.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { ORIGIN, launchOffline, openSite, settled } from "../lib/site-fake.ts";
import type { FakeSite, OpenOptions, Script } from "../lib/site-fake.ts";
import { reach } from "../lib/site-measure.ts";
import { STATES } from "../lib/site-states.ts";
import { AUTHORIZE, RECENT, SESSIONS_LISTED } from "../lib/site-account-states.ts";
import { CLASSBEAT_ERROR, CLASSBEAT_STATES, SIGNED_IN_ME, SIGNED_OUT_ME, START, expectedStartBody } from "../lib/site-classbeat-states.ts";

const SIZE = { width: 390, height: 844 } as const;
const SIGN_IN = '{"purpose":"sign_in"}';
const REAUTH = '{"purpose":"reauth"}';
const GO = { status: 200, body: { authorize: AUTHORIZE } } as const;

let browser: Browser;
const open = (path: string, o: Partial<OpenOptions> = {}): Promise<FakeSite> => openSite(browser, path, { ...SIZE, ...o });
const press = (page: Page, name: string): Promise<void> => page.getByRole("button", { name, exact: true }).click();
const path = (page: Page): string => page.url().slice(ORIGIN.length);
const starts = (site: FakeSite): (string | null)[] => site.api.filter((a) => a.route === START).map((a) => a.body);
const routes = (site: FakeSite): string[] => site.api.map((a) => a.route);
const labels = (page: Page): Promise<string[]> => page.locator("main button, main a.btn").allTextContents();
const waitFor = async (until: () => boolean): Promise<void> => {
  for (let i = 0; i < 300 && !until(); i += 1) await new Promise((r) => setTimeout(r, 10));
};

before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

describe("Sign in with classbeat (ADR 0010, section 6)", () => {
  it("is first, the one filled button, above the follower group", async () => {
    const site = await open("/sign-in");
    await site.page.waitForSelector(".group");
    assert.equal(await site.page.locator("main .btn.primary").count(), 1);
    assert.equal(await site.page.locator("main .btn.primary").textContent(), "Sign in with classbeat");
    assert.equal((await labels(site.page))[0], "Sign in with classbeat");
    assert.equal(await site.page.locator(".group h2").textContent(), "Follower accounts");
    assert.equal(await site.page.locator(".group input[name=email]").count(), 1, "the address field is in the follower group");
    assert.match(await site.page.locator("main").innerText(), /You sign in at classbeat, then come back to your classes\./);
    assert.deepEqual(site.api, [], "nothing is asked before a button is pressed");
    await site.context.close();
  });

  it("sends exactly {\"purpose\":\"sign_in\"} and goes to the authorize address", async () => {
    const site = await open("/sign-in", { script: { [START]: GO } });
    await press(site.page, "Sign in with classbeat");
    await waitFor(() => site.toClassbeat.length > 0);
    assert.deepEqual(starts(site), [SIGN_IN]);
    assert.deepEqual(routes(site), [START]);
    assert.deepEqual(site.toClassbeat, [AUTHORIZE]);
    assert.deepEqual(site.external, []);
    await site.context.close();
  });

  it("sends no return entry from the companion either, and says to open the companion again", async () => {
    const site = await open("/sign-in#return=control.BCDF-GHJK", { script: { [START]: GO } });
    await site.page.waitForSelector(".group");
    assert.equal(path(site.page), "/sign-in");
    assert.match(await site.page.locator("main").innerText(), /come back to your classes\. Then open the companion again\./);
    await press(site.page, "Sign in with classbeat");
    await waitFor(() => site.toClassbeat.length > 0);
    assert.deepEqual(starts(site), [SIGN_IN], "no return_to, no class code");
    assert.deepEqual(site.toClassbeat, [AUTHORIZE]);
    await site.context.close();
  });

  it("while it opens, shows one line and keeps every action, disabled, with its label", async () => {
    const site = await open("/sign-in", { script: { [START]: { status: 200, hold: true } } });
    const before = await labels(site.page);
    await press(site.page, "Sign in with classbeat");
    await site.page.waitForSelector(".status");
    assert.equal(await site.page.locator(".status").textContent(), "Opening classbeat…");
    assert.deepEqual(await labels(site.page), before, "no label changes");
    const enabled = await site.page.locator("main button:not([disabled])").count();
    assert.equal(enabled, 0, "every button waits");
    await site.release();
    await site.context.close();
  });

  for (const c of [
    { name: "a server fault", reply: { status: 503, body: { error: "unavailable" } }, head: "That did not work, and it was not your doing" },
    { name: "offline", reply: { status: 0, fail: true }, head: null },
    { name: "the limit", reply: { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "480" } }, head: "Too many sign-in requests" },
  ] as const) {
    it(`after ${c.name}, shows a plate with no "Try again": the button below starts again`, async () => {
      const site = await open("/sign-in", { script: { [START]: [c.reply, GO] } });
      await press(site.page, "Sign in with classbeat");
      await site.page.waitForSelector(".plate");
      if (c.head) assert.match(await site.page.locator(".plate").innerText(), new RegExp(c.head));
      assert.equal(await site.page.locator(".plate button").count(), 0, "no Try again on the plate");
      assert.equal(await site.page.locator(".btn.primary").textContent(), "Sign in with classbeat");
      await press(site.page, "Sign in with classbeat");
      await waitFor(() => site.toClassbeat.length > 0);
      assert.deepEqual(starts(site), [SIGN_IN, SIGN_IN]);
      assert.deepEqual(site.toClassbeat, [AUTHORIZE]);
      await site.context.close();
    });
  }

  it("after the session ended, says so and what to open again", async () => {
    const state = STATES.find((s) => s.name === "sign-in-session-ended");
    assert.ok(state);
    const site = await reach(browser, { state, width: 390, zoom: 1, ink: false });
    const text = await site.page.locator("main").innerText();
    assert.match(text, /Sign in again\. You come back to your classes, so open the page you were on again\./);
    assert.match(text, /then come back to your classes\. Open the page you were on again\./);
    assert.doesNotMatch(text, /carry on|always works/i);
    await site.context.close();
  });

  it("the Check your mail page says an email link does not work for someone who runs classes", async () => {
    const site = await open("/sign-in", { script: { "POST sign-in/link": { status: 200, body: { status: "accepted" } } } });
    await site.page.fill("input[name=email]", "ana@example.com");
    await press(site.page, "Email me a sign-in link");
    await site.page.waitForSelector(".note");
    assert.match(await site.page.locator("main").innerText(), /If you run classes, an email link does not work for you\. Go back and sign in with classbeat\./);
    await site.context.close();
  });
});

describe("#error=classbeat asks GET me first (ADR 0010, sections 2 and 5)", () => {
  it("signed out (401): the sign-in did not finish; the address is cleaned, nothing else is asked", async () => {
    const site = await open(CLASSBEAT_ERROR, { script: { "GET me": SIGNED_OUT_ME, [START]: GO } });
    await site.page.waitForSelector(".plate");
    assert.equal(path(site.page), "/sign-in");
    assert.match(await site.page.locator(".plate").innerText(), /The sign-in with classbeat did not finish/);
    assert.equal(await site.page.locator(".plate button").count(), 0);
    assert.equal(await site.page.evaluate(() => document.activeElement?.classList.contains("plate")), true, "focus is on the plate");
    await settled(site);
    assert.deepEqual(routes(site), ["GET me"]);
    await press(site.page, "Sign in with classbeat");
    await waitFor(() => site.toClassbeat.length > 0);
    assert.deepEqual(starts(site), [SIGN_IN]);
    await site.context.close();
  });

  it("still signed in (200): classbeat did not confirm; only a re-authentication is offered", async () => {
    const site = await open(CLASSBEAT_ERROR, { script: { "GET me": SIGNED_IN_ME, [START]: GO } });
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    assert.equal(path(site.page), "/sign-in");
    assert.equal(await site.page.locator("h1").textContent(), "Confirm it is you");
    assert.match(await site.page.locator(".plate").innerText(), /classbeat did not confirm it is you/);
    assert.equal(await site.page.locator("input[name=email], .group").count(), 0, "no email form, no follower group");
    assert.deepEqual(await labels(site.page), ["Confirm with classbeat", "Back to your classes"]);
    assert.equal(await site.page.locator("main a.btn").getAttribute("href"), "/classes");
    await press(site.page, "Confirm with classbeat");
    await waitFor(() => site.toClassbeat.length > 0);
    assert.deepEqual(starts(site), [REAUTH], "reauth, never sign_in");
    assert.deepEqual(site.toClassbeat, [AUTHORIZE]);
    assert.equal(await site.page.locator("[data-confirm=waiting]").textContent(), "Opening classbeat…");
    await site.context.close();
  });

  it("still signed in, a failed start keeps the label; a 401 start goes to Sign in, Your session ended", async () => {
    const site = await open(CLASSBEAT_ERROR, { script: { "GET me": SIGNED_IN_ME, [START]: [{ status: 0, fail: true }, { status: 401, body: { error: "not_signed_in" } }] } });
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    await press(site.page, "Confirm with classbeat");
    await site.page.waitForSelector(".plate[data-confirm=failed]");
    assert.deepEqual((await labels(site.page)).slice(0, 1), ["Confirm with classbeat"]);
    await press(site.page, "Confirm with classbeat");
    await site.page.waitForSelector(".note");
    assert.equal(path(site.page), "/sign-in");
    assert.match(await site.page.locator(".note").innerText(), /Your session ended/);
    assert.deepEqual(starts(site), [REAUTH, REAUTH]);
    await site.context.close();
  });

  for (const c of [
    { name: "offline", reply: { status: 0, fail: true } },
    { name: "a server fault", reply: { status: 500, body: { error: "internal" } } },
    { name: "the limit", reply: { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "300" } } },
  ] as const) {
    it(`a check that fails (${c.name}) shows its plate, offers no sign-in action, and Try again asks GET me again`, async () => {
      const script: Script = { "GET me": [c.reply, SIGNED_OUT_ME] };
      const site = await open(CLASSBEAT_ERROR, { script });
      await site.page.waitForSelector(".plate");
      assert.equal(path(site.page), "/sign-in");
      assert.deepEqual(await labels(site.page), ["Try again"]);
      assert.equal(await site.page.locator("input[name=email]").count(), 0);
      assert.deepEqual(routes(site), ["GET me"]);
      await press(site.page, "Try again");
      await site.page.waitForSelector(".group");
      assert.match(await site.page.locator(".plate").innerText(), /did not finish/);
      assert.deepEqual(routes(site), ["GET me", "GET me"], "no start without a press");
      await site.context.close();
    });
  }

  for (const hash of ["#error=classbeatx", "#error=CLASSBEAT", "#error=other", "#error=classbeat&x=1"]) {
    it(`reads only the exact value: ${hash} is the plain sign-in page, with no GET me`, async () => {
      const site = await open(`/sign-in${hash}`);
      await site.page.waitForSelector(".group");
      await settled(site);
      assert.equal(path(site.page), "/sign-in");
      assert.deepEqual(site.api, []);
      assert.equal(await site.page.locator(".plate, .note").count(), 0);
      await site.context.close();
    });
  }
});

describe("the account Opening row (Confirm it is you)", () => {
  it("is one line, Opening classbeat…, with no plate and no button", async () => {
    const site = await open("/account/sessions", { clock: "day", script: { ...SESSIONS_LISTED, "POST sessions/end-all": RECENT, [START]: { status: 200, hold: true } } });
    await site.page.getByRole("button", { name: "Sign out everywhere", exact: true }).first().click();
    await site.page.locator(".ac-panel").getByRole("button", { name: "Sign out everywhere" }).click();
    await site.page.waitForSelector(".plate[data-confirm=ask]");
    await press(site.page, "Confirm with classbeat");
    await site.page.waitForSelector("[data-confirm=waiting]");
    const text = await site.page.locator("main").innerText();
    assert.equal(text.split("Opening classbeat…").length - 1, 1, "the line once");
    assert.match(text, /Nothing was changed here\./);
    assert.equal(await site.page.locator(".plate").count(), 0);
    assert.equal(await site.page.getByRole("button", { name: "Confirm with classbeat" }).count(), 0);
    assert.deepEqual(starts(site), [REAUTH]);
    await site.release();
    await site.context.close();
  });
});

describe("every classbeat start in every state", () => {
  it("covers the sign-in states", () => {
    assert.ok(CLASSBEAT_STATES.length >= 10);
    assert.equal(expectedStartBody(CLASSBEAT_STATES[0]), SIGN_IN);
  });
  for (const state of STATES.filter((s) => s.script?.[START] !== undefined && s.steps !== undefined)) {
    it(`${state.name} sends exactly ${expectedStartBody(state)}`, async () => {
      const site = await reach(browser, { state, width: 390, zoom: 1, ink: false });
      await settled(site);
      const sent = starts(site);
      assert.ok(sent.length <= 1, `${state.name}: one start at most`);
      for (const body of sent) assert.equal(body, expectedStartBody(state), state.name);
      await site.context.close();
    });
  }
});
