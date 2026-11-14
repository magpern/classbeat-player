// The Classes pages' flows on the fake backend (docs/design/site.md, "Classes"; issue #413): the
// list reads every page and sorts by title, the filter and its key, the class details and its
// actions row, the delete confirmation (Keep first and focused, Esc, the request, the note), and
// the error states. Fakes only: no network.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { CLASS_ID, classReply, entry, idOf, library, listReply } from "../lib/class-states.ts";
import { launchOffline, openSite } from "../lib/site-fake.ts";
import type { FakeSite, Reply, Script } from "../lib/site-fake.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const open = (path: string, script: Script, width = 390): Promise<FakeSite> => openSite(browser, path, { width, height: 844, script });
const detail = `/classes/${CLASS_ID}`;
const NOT_FOUND: Reply = { status: 404, body: { error: "not_found" } };
const rowTitles = (site: FakeSite): Promise<string[]> => site.page.$$eval(".rows .row .t", (els) => els.map((e) => e.textContent ?? ""));
const press = (site: FakeSite, name: string) => site.page.getByRole("button", { name, exact: true }).click();
const active = (site: FakeSite): Promise<string> => site.page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? document.activeElement?.tagName ?? "");

describe("the class list", () => {
  it("reads every page and sorts by title, case and accents ignored, equal titles by id", async () => {
    const e = (n: number, title: string, at: string, removed = false) => entry(idOf(n), title, 60_000, at, removed);
    const script: Script = {
      "GET classes": [
        listReply([e(1, "banana", "2026-11-13T00:00:00Z"), e(4, "Same", "2026-01-01T00:00:00Z"), e(2, "éclair", "2026-05-01T00:00:00Z")], "cursor one"),
        listReply([e(3, "Apple", "2020-01-01T00:00:00Z"), e(5, "same", "2026-11-14T00:00:00Z"), e(6, "Gone", "2026-11-14T00:00:00Z", true)]),
      ],
    };
    const site = await open("/classes", script);
    await site.page.waitForSelector(".rows .row");
    assert.deepEqual(await rowTitles(site), ["Apple", "banana", "éclair", "Same", "same"], "title order; ties by id (4 before 5); the removal marker is not shown");
    assert.deepEqual(site.api.map((a) => a.route), ["GET classes", "GET classes"]);
    assert.deepEqual(site.api.map((a) => new URL(a.url).search), ["", "?before=cursor%20one&limit=200"]);
    assert.equal(await site.page.locator(".count").textContent(), "5 classes");
    const link = site.page.locator(".rows .row a").first();
    assert.equal(await link.getAttribute("href"), `/classes/${idOf(3)}`);
    await site.context.close();
  });

  it("never offers a date or use ordering, rank or recent list", async () => {
    const site = await open("/classes", { "GET classes": listReply(library()) });
    await site.page.waitForSelector(".rows .row");
    const text = (await site.page.locator("main").innerText()).toLowerCase();
    for (const word of ["recent", "popular", "most played", "favourite", "last played", "times played", "rank", "sort by", "newest"]) assert.ok(!text.includes(word), word);
    assert.equal(await site.page.locator("main select, main [aria-sort], main th").count(), 0, "no control that re-orders the list");
    await site.context.close();
  });

  it("shows the filter from 8 classes, not before", async () => {
    for (const [n, shown] of [[7, 0], [8, 1]] as const) {
      const site = await open("/classes", { "GET classes": listReply(library(12).slice(0, n)) });
      await site.page.waitForSelector(".rows .row");
      assert.equal(await site.page.locator("input[name=filter]").count(), shown, `${n} classes`);
      await site.context.close();
    }
  });

  it("filters by title, ignoring case and accents, and says how many it found", async () => {
    const site = await open("/classes", { "GET classes": listReply(library()) });
    await site.page.waitForSelector(".rows .row");
    await site.page.fill("input[name=filter]", "RECOVERY");
    assert.deepEqual(await rowTitles(site), ["Recovery spin"]);
    assert.equal(await site.page.locator("p.small[role=status]").innerText(), "1 of 12 classes");
    await site.page.fill("input[name=filter]", "zzz");
    assert.deepEqual(await rowTitles(site), []);
    assert.equal(await site.page.locator("p.small[role=status]").innerText(), "No class has that in its title");
    await site.context.close();
  });

  it("focuses the filter on `/`, but not while typing in a field", async () => {
    const site = await open("/classes", { "GET classes": listReply(library()) });
    await site.page.waitForSelector(".rows .row");
    await site.page.keyboard.press("/");
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLInputElement).name), "filter");
    assert.equal(await site.page.inputValue("input[name=filter]"), "", "the slash is not typed into the field");
    await site.page.keyboard.type("a/b");
    assert.equal(await site.page.inputValue("input[name=filter]"), "a/b", "while typing, a slash is a slash");
    await site.page.fill("input[name=filter]", "");
    await site.page.locator(".rows .row a").first().focus();
    await site.page.keyboard.press("/");
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLInputElement).name), "filter", "from a link it focuses the filter");
    await site.context.close();
  });

  it("has no `/` key under 8 classes", async () => {
    const site = await open("/classes", { "GET classes": listReply(library(3)) });
    await site.page.waitForSelector(".rows .row");
    await site.page.keyboard.press("/");
    assert.equal(await site.page.evaluate(() => document.activeElement === document.body), true);
    await site.context.close();
  });

  it("lists 100 rows, then Show 100 more, and puts the focus on the first new row", async () => {
    const many = Array.from({ length: 130 }, (_, i) => entry(idOf(i + 1), `Class ${String(i + 1).padStart(3, "0")}`, 60_000, "2026-11-01T00:00:00Z"));
    const site = await open("/classes", { "GET classes": listReply(many) });
    await site.page.waitForSelector(".rows .row");
    assert.equal((await rowTitles(site)).length, 100);
    await press(site, "Show 30 more");
    assert.equal((await rowTitles(site)).length, 130);
    assert.equal(await active(site), "Class 101");
    assert.equal(await site.page.getByRole("button", { name: /Show/ }).count(), 0);
    await site.context.close();
  });

  it("shows the empty state with a way to Linked apps", async () => {
    const site = await open("/classes", { "GET classes": listReply([]) });
    await site.page.waitForSelector(".btns a");
    assert.equal(await site.page.locator("h2").textContent(), "No classes yet");
    assert.equal(await site.page.getByRole("link", { name: "Linked apps" }).getAttribute("href"), "/account/links");
    await site.context.close();
  });

  it("goes to Sign in with the session-ended note when the session ended", async () => {
    const ended: Reply = { status: 401, body: { error: "not_signed_in" } };
    const site = await open("/classes", { "GET classes": [ended, listReply(library(2))]});
    await site.page.waitForSelector("input[name=email]");
    assert.equal(await site.page.locator(".note").count(), 1, "Your session ended");
    await site.context.close();
  });
});

describe("the class details page", () => {
  it("shows the title, the facts, Time in zone, Songs and Intervals, in that order", async () => {
    const site = await open(detail, { [`GET classes/${CLASS_ID}`]: classReply() });
    await site.page.waitForSelector(".zrow");
    assert.equal(await site.page.locator("h1").textContent(), "Monday morning endurance");
    assert.match(await site.page.locator("main > p.small").first().innerText(), /^45:00 · Cycling · Spotify, 6 songs · From classbeat · changed /);
    assert.deepEqual(await site.page.locator("main h2").allTextContents(), ["Time in zone", "Songs", "Intervals"]);
    assert.equal(await site.page.locator(".zrow").count(), 5);
    assert.equal(await site.page.locator(".song").count(), 6);
    assert.equal(await site.page.locator(".iv").count(), 8);
    assert.equal(await site.page.locator(".zrow .zn").first().innerText(), "1");
    assert.equal(await site.page.locator(".iv .zz").first().innerText(), "Zone 1 Recovery");
    assert.equal(await site.page.getByRole("link", { name: "← Classes" }).getAttribute("href"), "/classes");
    await site.context.close();
  });

  it("is read only: no field, no edit, no reorder control, no rider", async () => {
    const site = await open(detail, { [`GET classes/${CLASS_ID}`]: classReply() });
    await site.page.waitForSelector(".zrow");
    assert.equal(await site.page.locator("main input, main select, main textarea, main [contenteditable], main [draggable=true]").count(), 0);
    assert.deepEqual(await site.page.locator("main button").allTextContents(), ["Delete class"]);
    await site.context.close();
  });

  for (const width of [320, 390, 1280]) {
    it(`puts Play on this device and Delete class in one row under the facts, Play first, at ${width} px`, async () => {
      const site = await open(detail, { [`GET classes/${CLASS_ID}`]: classReply() }, width);
      await site.page.waitForSelector(".zrow");
      const found = await site.page.evaluate(() => {
        const play = document.querySelector<HTMLElement>("a.btn");
        const del = [...document.querySelectorAll<HTMLElement>("button.btn")].find((b) => b.textContent === "Delete class");
        const facts = document.querySelector("main > p.small");
        const firstSection = [...document.querySelectorAll("main h2")].find((h) => h.textContent === "Time in zone");
        if (!play || !del || !facts || !firstSection) return null;
        const a = play.getBoundingClientRect();
        const b = del.getBoundingClientRect();
        const follows = (x: Node, y: Node): boolean => !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
        return {
          sameRow: play.parentElement === del.parentElement,
          playFirst: follows(play, del),
          afterFacts: follows(facts, play) && follows(del, firstSection),
          gap: Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom),
          filled: play.classList.contains("primary") || del.classList.contains("primary"),
          scroll: document.documentElement.scrollWidth <= innerWidth,
        };
      });
      assert.ok(found, "both actions are there");
      assert.deepEqual({ ...found, gap: found.gap >= 8 }, { sameRow: true, playFirst: true, afterFacts: true, gap: true, filled: false, scroll: true });
      assert.equal(await site.page.getByRole("link", { name: "Play on this device", exact: true }).getAttribute("href"), `/play#${CLASS_ID}`);
      await site.context.close();
    });
  }

  it("shows no Play link for a class that is not there", async () => {
    const site = await open(detail, { [`GET classes/${CLASS_ID}`]: NOT_FOUND });
    await site.page.waitForSelector(".btns a");
    assert.equal(await site.page.getByText("Play on this device").count(), 0);
    assert.equal(await site.page.locator("h1").textContent(), "That class is not here");
    assert.equal(await site.page.locator("nav .a.cur").textContent(), "Classes");
    await site.context.close();
  });

  for (const [name, reply, plate] of [
    ["too many requests", { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "300" } }, "Please wait a little"],
    ["offline", { status: 0, fail: true }, "You are offline"],
    ["a server fault", { status: 500, body: { error: "internal" } }, "That did not work, and it was not your doing"],
  ] as const) {
    it(`uses the site's error state for ${name}`, async () => {
      const site = await open(detail, { [`GET classes/${CLASS_ID}`]: reply });
      await site.page.waitForSelector(".plate");
      assert.match(await site.page.locator(".plate").innerText(), new RegExp(plate));
      assert.equal(await site.page.getByText("Play on this device").count(), 0);
      await site.context.close();
    });
  }
});

describe("deleting a class", () => {
  const withDelete = (reply: Reply | readonly Reply[]): Script => ({ [`GET classes/${CLASS_ID}`]: classReply(), [`DELETE classes/${CLASS_ID}`]: reply, "GET classes": listReply(library().slice(1)) });

  it("opens the panel in the row's place with Keep the class focused, and sends nothing yet", async () => {
    const site = await open(detail, withDelete({ status: 204 }));
    await site.page.waitForSelector(".zrow");
    await press(site, "Delete class");
    const panel = site.page.locator(".panel[role=alertdialog]");
    assert.equal(await panel.locator("h2").textContent(), "Delete this class?");
    assert.deepEqual(await panel.locator("button").allTextContents(), ["Keep the class", "Delete class"], "the safe button first");
    assert.equal(await active(site), "Keep the class");
    assert.equal(await panel.getByRole("button", { name: "Keep the class" }).evaluate((b) => b.classList.contains("primary")), true);
    assert.equal(await site.page.locator("a.btn").count(), 0, "the actions row is replaced");
    assert.ok(!site.api.some((a) => a.method === "DELETE"));
    await site.context.close();
  });

  it("cancels with Esc, returns the focus to Delete class and sends nothing", async () => {
    const site = await open(detail, withDelete({ status: 204 }));
    await site.page.waitForSelector(".zrow");
    await press(site, "Delete class");
    await site.page.keyboard.press("Escape");
    assert.equal(await site.page.locator(".panel").count(), 0);
    assert.equal(await active(site), "Delete class");
    assert.equal(await site.page.getByRole("link", { name: "Play on this device" }).count(), 1, "the row is back with Play");
    assert.ok(!site.api.some((a) => a.method === "DELETE"));
    await site.context.close();
  });

  it("cancels with Keep the class", async () => {
    const site = await open(detail, withDelete({ status: 204 }));
    await site.page.waitForSelector(".zrow");
    await press(site, "Delete class");
    await press(site, "Keep the class");
    assert.equal(await site.page.locator(".panel").count(), 0);
    assert.equal(await active(site), "Delete class");
    await site.context.close();
  });

  it("sends DELETE classes/{id} and, on 204, shows the list with the Deleted note and the heading focused", async () => {
    const site = await open(detail, withDelete({ status: 204 }));
    await site.page.waitForSelector(".zrow");
    await press(site, "Delete class");
    await press(site, "Delete class");
    await site.page.waitForSelector(".note");
    assert.deepEqual(site.api.map((a) => a.route), [`GET classes/${CLASS_ID}`, `DELETE classes/${CLASS_ID}`, "GET classes"]);
    assert.deepEqual(site.crossSite, [], "the request was a same-origin one");
    assert.equal(new URL(site.page.url()).pathname, "/classes");
    const note = await site.page.locator(".note").innerText();
    assert.match(note, /Deleted “Monday morning endurance”/);
    assert.match(note, /Your devices remove it the next time they sync/);
    assert.equal(await site.page.evaluate(() => document.activeElement?.tagName), "H1");
    assert.equal(await site.page.locator(".rows .row").count(), 11, "the list is the account's, read again");
    // The note is shown once: the page again has none.
    await site.page.reload();
    await site.page.waitForSelector(".rows .row");
    assert.equal(await site.page.locator(".note").count(), 0);
    await site.context.close();
  });

  it("shows the not-found state when the route says the class is gone", async () => {
    const site = await open(detail, withDelete(NOT_FOUND));
    await site.page.waitForSelector(".zrow");
    await press(site, "Delete class");
    await press(site, "Delete class");
    await site.page.waitForSelector(".btns a");
    assert.equal(await site.page.locator("h1").textContent(), "That class is not here");
    assert.equal(await active(site), "That class is not here");
    await site.context.close();
  });

  for (const [name, reply, plate] of [
    ["too many requests", { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "300" } }, "Please wait a little"],
    ["a server fault", { status: 500, body: { error: "internal" } }, "That did not work, and it was not your doing"],
  ] as const) {
    it(`keeps the page and the panel on ${name}, and Try again sends it again`, async () => {
      const site = await open(detail, withDelete([reply, { status: 204 }]));
      await site.page.waitForSelector(".zrow");
      await press(site, "Delete class");
      await press(site, "Delete class");
      await site.page.waitForSelector(".panel .plate");
      assert.match(await site.page.locator(".panel .plate").innerText(), new RegExp(plate));
      assert.equal(await site.page.locator(".zrow").count(), 5, "the class stays on the page");
      assert.equal(await site.page.getByRole("button", { name: "Keep the class" }).isEnabled(), true);
      await site.page.locator(".panel .plate").getByRole("button", { name: "Try again" }).click();
      await site.page.waitForSelector(".note");
      assert.equal(site.api.filter((a) => a.method === "DELETE").length, 2);
      await site.context.close();
    });
  }

  it("offline: the content stays, Delete class waits, and it is sent once when the browser is back", async () => {
    const site = await open(detail, withDelete([{ status: 0, fail: true }, { status: 204 }]));
    await site.page.waitForSelector(".zrow");
    await press(site, "Delete class");
    await press(site, "Delete class");
    await site.page.waitForSelector(".panel .plate");
    assert.match(await site.page.locator(".panel .plate").innerText(), /You are offline/);
    assert.equal(await site.page.getByRole("button", { name: "Delete class" }).isDisabled(), true, "a button that needs the server is off");
    assert.equal(await site.page.locator(".zrow").count(), 5);
    await site.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await site.page.waitForSelector(".note");
    assert.equal(site.api.filter((a) => a.method === "DELETE").length, 2, "one more request, not several");
    await site.context.close();
  });

  it("sends the person to Sign in when the session ended, and back to the class", async () => {
    const site = await open(detail, withDelete({ status: 401, body: { error: "not_signed_in" } }));
    await site.page.waitForSelector(".zrow");
    await press(site, "Delete class");
    await press(site, "Delete class");
    await site.page.waitForSelector("input[name=email]");
    assert.equal(await site.page.locator(".note").count(), 1);
    await site.context.close();
  });
});
