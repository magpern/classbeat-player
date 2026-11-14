// The way in and out of a class on the web player page (ADR 0008, section 2; docs/design/play.md, "The
// picker and the states around it"): reload, the picker, an address that names no class, Close class, signed
// out, offline and not found, sign out, and the picker's order and filter. On the fake site, no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLASS_ID, classScript, listAnswer, NOT_FOUND, NOT_SIGNED_IN, OTHER_ID, openPlay } from "../lib/play-fake.ts";
import { harness, link, text } from "../lib/play-drive.ts";
import { library } from "../lib/play-picker-states.ts";
import { BASE_DOC, opened, started, tickBy } from "../lib/play-states.ts";
import { ORIGIN } from "../lib/site-fake.ts";

const { open, browser } = harness();

describe("the way in and out of a class", () => {
  it("a reload during a class starts it again at its start, with the notice until Start", async () => {
    // The page's own clock, not Playwright's: a faked clock hides the navigation's type from the page.
    const site = await openPlay(browser(), { width: 390, height: 844, hash: `#${CLASS_ID}`, script: classScript(BASE_DOC), clock: false });
    await opened(site.page);
    assert.equal(await link(site.page), "Press Start", "a first load is not a reload");
    await site.page.click('[data-action="start"]');
    await site.page.waitForSelector(".count");
    await site.page.reload();
    await opened(site.page);
    assert.equal(await link(site.page), "Reloaded: back to the start");
    assert.equal(await text(site.page, ".gel .lbl"), "First zone");
    assert.equal(await site.page.locator(".count").count(), 0, "the class and its place are lost");
    await site.page.click('[data-action="start"]');
    await site.page.waitForSelector(".count");
    assert.equal(await link(site.page), "Manual clock", "the notice goes at Start");
    assert.equal(site.api.filter((a) => a.route === `GET classes/${CLASS_ID}`).length, 2, "the class is fetched again");
    await site.context.close();
  });

  it("a class opened from the picker is not 'reloaded', and Previous and Next before the start move the starting point", async () => {
    const site = await open({ hash: "", script: { ...classScript(BASE_DOC), "GET classes": listAnswer(library(3).map((e, i) => (i === 0 ? { ...e, class_id: CLASS_ID } : e))) } });
    await site.page.waitForSelector(".rows .row");
    await site.page.click(`a[href="/play#${CLASS_ID}"]`);
    await opened(site.page);
    assert.equal(await link(site.page), "Press Start");
    await site.page.keyboard.press("ArrowRight");
    await tickBy(site.page, 100);
    assert.equal(await text(site.page, ".gel .lbl"), "Starts here");
    assert.equal(await text(site.page, ".gel-num"), "2");
    assert.equal(await link(site.page), "Press Start");
    await site.page.keyboard.press("ArrowLeft");
    await tickBy(site.page, 100);
    assert.equal(await text(site.page, ".gel .lbl"), "First zone");
    await site.context.close();
  });

  it("an id that is not a canonical lowercase UUID is ignored and the picker shows, with no class request", async () => {
    for (const hash of [`#${CLASS_ID.toUpperCase()}`, `#${CLASS_ID.slice(1)}`, `#${CLASS_ID}0`, "#not-an-id", "#"]) {
      const site = await open({ hash, script: { "GET classes": listAnswer(library(3)) } });
      await site.page.waitForSelector(".rows .row");
      assert.deepEqual(site.api.map((a) => a.route), ["GET classes"], hash);
      assert.equal(await text(site.page, "h1 > span"), "Play a class", hash);
      assert.equal(await text(site.page, ".count"), "3 classes", hash);
      await site.context.close();
    }
  });

  it("Close class on Class Complete goes back to the picker", async () => {
    const site = await open({ script: { ...classScript(BASE_DOC), "GET classes": listAnswer(library(3)) } });
    await started(site.page);
    await site.page.clock.fastForward(BASE_DOC.class.length_ms);
    await tickBy(site.page, 500);
    assert.equal(await text(site.page, ".gel-name"), "Complete");
    assert.deepEqual(await site.page.locator("[data-action]").evaluateAll((els) => els.map((e) => e.getAttribute("data-action"))), ["close"]);
    assert.equal(await text(site.page, ".controls .sub"), "Back to the class list");
    await site.page.click('[data-action="close"]');
    await site.page.waitForSelector(".rows .row");
    assert.equal(await text(site.page, "h1 > span"), "Play a class");
    await site.context.close();
  });
});


describe("signed out, offline and not found", () => {
  it("a 401 on the list shows Sign in, which goes to the site's sign-in; after a session it says so", async () => {
    const site = await open({ hash: "", script: { "GET classes": NOT_SIGNED_IN } });
    await site.page.waitForSelector(".btns a");
    assert.equal(await text(site.page, "p"), "Sign in to see your classes and run one here.");
    assert.equal(await site.page.locator(".btns a").getAttribute("href"), "/sign-in#return=play", "the sign-in comes back to the picker");
    assert.equal(await site.page.locator("nav").count(), 0, "no navigation when signed out");
    assert.equal(await site.page.locator(".note").count(), 0);
    await site.context.close();
    const ended = await open({ hash: "", script: { "GET classes": [{ ...listAnswer(library(2), "n") }, NOT_SIGNED_IN] } });
    await ended.page.waitForSelector(".note");
    assert.match((await text(ended.page, ".note")) ?? "", /Your session ended/);
    await ended.context.close();
  });

  it("a 401 on a class shows the same, and the class is not drawn", async () => {
    const site = await open({ script: { [`GET classes/${CLASS_ID}`]: NOT_SIGNED_IN } });
    await site.page.waitForSelector(".btns a");
    assert.equal(await site.page.locator(".btns a").getAttribute("href"), `/sign-in#return=play.${CLASS_ID}`, "the sign-in comes back to this class");
    assert.equal(await site.page.locator(".controls").count(), 0);
    await site.context.close();
  });

  it("offline at open shows the plate; Try again asks again, and the page tries by itself when it is back online", async () => {
    const offline = { status: 0, fail: true } as const;
    const site = await open({ hash: "", script: { "GET classes": [offline, offline, listAnswer(library(3))] } });
    await site.page.waitForSelector(".plate");
    assert.match((await text(site.page, ".plate")) ?? "", /You are offline/);
    assert.match((await text(site.page, ".plate")) ?? "", /Once a class is open, it runs without the internet/);
    await site.page.getByRole("button", { name: "Try again", exact: true }).click();
    await site.page.waitForSelector(".plate");
    await site.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await site.page.waitForSelector(".rows .row");
    assert.deepEqual(site.api.map((a) => a.route), ["GET classes", "GET classes", "GET classes"]);
    await site.context.close();
  });

  it("a class that is not there (404) says so, and its button goes to the picker", async () => {
    const site = await open({ script: { [`GET classes/${CLASS_ID}`]: NOT_FOUND, "GET classes": listAnswer(library(3)) } });
    await site.page.waitForSelector(".btns button");
    assert.equal(await text(site.page, "h1 > span"), "That class is not here");
    await site.page.getByRole("button", { name: "Your classes", exact: true }).click();
    await site.page.waitForSelector(".rows .row");
    assert.equal(new URL(site.page.url()).hash, "");
    assert.equal(OTHER_ID.length, 36);
    await site.context.close();
  });

  it("Sign out asks the site to sign out and goes to its sign-in page", async () => {
    const site = await open({ hash: "", script: { "GET classes": listAnswer(library(3)), "POST sign-out": { status: 204 } } });
    await site.page.waitForSelector(".rows .row");
    await site.page.getByRole("button", { name: "Sign out" }).click();
    await site.page.waitForURL(`${ORIGIN}/sign-in`);
    assert.ok(site.api.some((a) => a.route === "POST sign-out"));
    await site.context.close();
  });
});


describe("the picker", () => {
  it("lists the classes title A to Z, each title a link to /play#<id>, and the filter shows from 8", async () => {
    const site = await open({ hash: "", script: { "GET classes": listAnswer(library()) } });
    await site.page.waitForSelector(".rows .row");
    const titles = await site.page.locator(".row .t").allTextContents();
    assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b)));
    assert.equal(titles.length, 12);
    assert.match((await site.page.locator(".row .t a").first().getAttribute("href")) ?? "", /^\/play#[0-9a-f-]{36}$/);
    await site.page.getByLabel("Find a class").fill("thursd");
    assert.deepEqual(await site.page.locator(".row .t").allTextContents(), ["Thursday threshold"]);
    assert.equal(await text(site.page, ".count"), "12 classes");
    await site.context.close();
    const few = await open({ hash: "", script: { "GET classes": listAnswer(library(7)) } });
    await few.page.waitForSelector(".rows .row");
    assert.equal(await few.page.locator("input").count(), 0, "no filter under 8 classes");
    await few.context.close();
  });

  it("shows no marker of a removed class", async () => {
    const entries = [...library(2), { ...library(3)[2], removed: true, title: "" }];
    const site = await open({ hash: "", script: { "GET classes": listAnswer(entries) } });
    await site.page.waitForSelector(".rows .row");
    assert.equal(await site.page.locator(".rows .row").count(), 2);
    await site.context.close();
  });
});
