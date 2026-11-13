// How the class list page behaves under the keyboard and the mouse (docs/design/class-list.md,
// "Keyboard"), on the real page in headless Chrome with a stand-in bridge that records the asks.
// Only Enter or the Start button starts; a click only selects; the filter folds accents; a poll
// that brings new rows keeps the selection on the same class and the scroll where it was.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { NOTICE_TEXT } from "../../src/core/pairing/view.ts";
import { row, view } from "../unit/list-fixtures.ts";
import { launchChrome, openList } from "./page.ts";
import type { Opened } from "./page.ts";
import { STATES } from "./states.ts";

let browser: Browser;
before(async () => {
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

const state = (name: string) => STATES.find((s) => s.name === name)!.view;
const SIZE = [1280, 800] as const;
const selectedTitle = (o: Opened): Promise<string> => o.page.locator(".row.sel .t").innerText();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("the list has the focus at first, with the first row selected; the arrow keys move the selection, Enter starts it with its id and hash", async () => {
  const v = state("synced");
  const o = await openList(browser, SIZE, v);
  try {
    assert.equal(await o.page.evaluate(() => document.activeElement?.id), "list");
    assert.equal(await selectedTitle(o), v.rows[0].title);
    await o.page.keyboard.press("ArrowDown");
    await o.page.keyboard.press("ArrowDown");
    assert.equal(await selectedTitle(o), v.rows[2].title);
    await o.page.keyboard.press("End");
    assert.equal(await selectedTitle(o), v.rows[11].title);
    await o.page.keyboard.press("Home");
    assert.equal(await selectedTitle(o), v.rows[0].title);
    assert.deepEqual(await o.calls(), [], "moving starts nothing");
    await o.page.keyboard.press("ArrowDown");
    await o.page.keyboard.press("Enter");
    assert.deepEqual(await o.calls(), [["start", v.rows[1].id, v.rows[1].hash]]);
  } finally {
    await o.close();
  }
});

test("a click only selects, a double-click does not start, and the Start button starts the selected class", async () => {
  const v = state("synced");
  const o = await openList(browser, SIZE, v);
  try {
    await o.page.locator(".row").nth(3).click();
    assert.equal(await selectedTitle(o), v.rows[3].title);
    await o.page.locator(".row").nth(4).dblclick();
    assert.equal(await selectedTitle(o), v.rows[4].title);
    assert.deepEqual(await o.calls(), []);
    await o.page.click(".foot button");
    assert.deepEqual(await o.calls(), [["start", v.rows[4].id, v.rows[4].hash]]);
  } finally {
    await o.close();
  }
});

test("the filter folds case and accents, shows n of N, / focuses it, Esc clears it and then returns to the list", async () => {
  const rows = [row("Café ride", 1), row("Zürich zone", 2), ...Array.from({ length: 8 }, (_, i) => row(`Plain ${i}`, i + 3))];
  const o = await openList(browser, SIZE, view({ rows, sync: { classes: rows.length } }));
  try {
    await o.page.keyboard.press("/");
    assert.equal(await o.page.evaluate(() => document.activeElement?.id), "filter-input");
    await o.page.keyboard.type("CAFE");
    assert.equal(await o.page.locator(".row").count(), 1);
    assert.equal(await o.page.locator("#filter-of").innerText(), "1 of 10");
    assert.equal(await selectedTitle(o), "Café ride");
    await o.page.keyboard.press("Escape");
    assert.equal(await o.page.inputValue("#filter-input"), "");
    assert.equal(await o.page.locator(".row").count(), 10);
    assert.equal(await o.page.evaluate(() => document.activeElement?.id), "filter-input", "the first Esc only clears");
    await o.page.keyboard.press("Escape");
    assert.equal(await o.page.evaluate(() => document.activeElement?.id), "list");
    // Typing a letter in the list goes to the filter with that letter typed.
    await o.page.keyboard.press("z");
    assert.equal(await o.page.inputValue("#filter-input"), "z");
    assert.equal(await o.page.evaluate(() => document.activeElement?.id), "filter-input");
    assert.deepEqual(await o.calls(), []);
  } finally {
    await o.close();
  }
});

test("with fewer than eight classes there is no filter, and a letter jumps to the next title starting with it", async () => {
  const rows = [row("Alpha", 1), row("Beta", 2), row("Bravo", 3)];
  const o = await openList(browser, SIZE, view({ rows, sync: { classes: 3 } }));
  try {
    assert.equal(await o.page.locator("#filter").isHidden(), true);
    await o.page.keyboard.press("b");
    assert.equal(await selectedTitle(o), "Beta");
    await o.page.keyboard.press("b");
    assert.equal(await selectedTitle(o), "Bravo");
  } finally {
    await o.close();
  }
});

test("while a class is played Enter and the button go back to it, never start another, and the other rows are not startable", async () => {
  const v = state("pinned-newer");
  const o = await openList(browser, SIZE, v);
  try {
    const playing = v.rows.find((r) => r.playing)!;
    assert.equal(await selectedTitle(o), playing.title);
    await o.page.locator(".row").first().click();
    assert.equal(await selectedTitle(o), playing.title, "the selection cannot leave the class being played");
    await o.page.keyboard.press("Enter");
    await o.page.click(".foot button");
    assert.deepEqual(await o.calls(), [["back"], ["back"]]);
    assert.equal(await o.page.locator(".row.off").count(), 11);
    assert.match(await o.page.locator(".row.sel .m").innerText(), /Playing now\s*Newer version after this class/);
  } finally {
    await o.close();
  }
});

test("a refused start shows the row as it now is: the next view is painted, and nothing else happens", async () => {
  const v = state("synced");
  const o = await openList(browser, SIZE, v);
  try {
    const changed = { ...v, rows: v.rows.map((r, i) => (i === 0 ? { ...r, hash: `sha256:${"e".repeat(64)}`, title: "Beginners: find your legs, new" } : r)) };
    await o.setView(changed);
    await o.page.keyboard.press("Enter");
    await o.page.waitForFunction(() => document.querySelector(".row .t")?.textContent === "Beginners: find your legs, new");
    assert.equal((await o.calls()).length, 1);
  } finally {
    await o.close();
  }
});

test("new rows from a poll keep the selection on the same class (by id) and do not scroll the list", async () => {
  const v = state("long-list");
  const o = await openList(browser, [1000, 720], v);
  try {
    for (let i = 0; i < 12; i++) await o.page.keyboard.press("ArrowDown");
    const title = await selectedTitle(o);
    const top = await o.page.evaluate(() => document.getElementById("list")!.scrollTop);
    await o.page.evaluate(() => (document.getElementById("list")!.scrollTop += 100));
    const scrolled = await o.page.evaluate(() => document.getElementById("list")!.scrollTop);
    assert.ok(scrolled > top);
    // A class arrives that sorts first: everything below it moves one place.
    await o.setView({ ...v, rows: [row("Aaa new class", 99), ...v.rows], sync: { ...v.sync, classes: 43 } });
    await o.page.waitForFunction(() => document.querySelectorAll(".row").length === 43, null, { timeout: 3000 });
    assert.equal(await selectedTitle(o), title);
    assert.equal(await o.page.evaluate(() => document.getElementById("list")!.scrollTop), scrolled);
  } finally {
    await o.close();
  }
});

test("the plates and panels act: Close and Esc dismiss a file error, Pair this computer pairs, Cancel and Esc cancel, Open the page again reopens", async () => {
  const error = await openList(browser, SIZE, state("file-error"));
  try {
    await error.page.click('#file-slot [data-action="close"]');
    await error.page.keyboard.press("Escape");
    assert.deepEqual(await error.calls(), [["dismiss"], ["dismiss"]]);
  } finally {
    await error.close();
  }
  const notPaired = await openList(browser, SIZE, state("not-paired"));
  try {
    assert.equal(await notPaired.page.evaluate(() => document.activeElement?.textContent), "Pair this computer", "no list: the panel's primary button has the focus");
    await notPaired.page.keyboard.press("Enter");
    assert.deepEqual(await notPaired.calls(), [["pair"]]);
  } finally {
    await notPaired.close();
  }
  const pairing = await openList(browser, SIZE, state("pairing"));
  try {
    assert.equal(await pairing.page.locator(".code").innerText(), "WDJB-MJHT");
    await pairing.page.click('[data-action="reopen"]');
    await pairing.page.keyboard.press("Escape");
    assert.deepEqual(await pairing.calls(), [["reopen"], ["cancel"]]);
  } finally {
    await pairing.close();
  }
  const open = await openList(browser, SIZE, state("empty"));
  try {
    await open.page.click("#open-file");
    await open.page.click('#body [data-action="open-file"]');
    assert.deepEqual(await open.calls(), [["open"], ["open"]]);
  } finally {
    await open.close();
  }
});

test("a notice from the pairing is shown verbatim on its plate, and the page puts nothing it was given into markup", async () => {
  const v = view({ sync: { status: "unpaired" }, pairing: { state: "unpaired", message: NOTICE_TEXT.revoked_on_site }, rows: [] });
  const o = await openList(browser, SIZE, v);
  try {
    assert.equal(await o.page.locator(".plate .st").innerText(), NOTICE_TEXT.revoked_on_site);
    const evil = row("<img src=x onerror=window.__pwned=1><b>bold</b>", 1);
    await o.setView(view({ rows: [evil], sync: { classes: 1 } }));
    await o.page.waitForSelector(".row");
    assert.equal(await o.page.locator(".row .t").innerText(), evil.title);
    assert.equal(await o.page.locator(".row .t b").count(), 0);
    assert.equal(await o.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? null), null);
  } finally {
    await o.close();
  }
});

test("with the system's reduced-motion setting nothing differs: there is no motion to reduce", async () => {
  const o = await openList(browser, SIZE, state("synced"), "reduce");
  try {
    await o.page.keyboard.press("ArrowDown");
    await sleep(50);
    assert.equal(await o.page.evaluate(() => document.getAnimations().length), 0);
  } finally {
    await o.close();
  }
});
