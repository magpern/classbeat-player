// The shipped iOS page with Swedebeat off, and with the setting on (issue #932; docs/design/swedebeat.md,
// "The iOS app", W11 to W13), in headless Chrome. The pages are built as shipped, with the setting read
// from the Swift line (build-config.mjs): the "on" site is the real Swift file with that line turned on,
// so a page that ignores the setting, hard-codes it, passes the wrong platform or drops the room's check
// fails here. Bridge stand-in, no device, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { NOT_AVAILABLE } from "../../src/swedebeat-off.ts";
import { ID } from "../room-fakes.ts";
import { buildSite, launchChrome, MOBILE, openPhonePage, shoot } from "./phone-page.ts";

const SWIFT = readFileSync(join(MOBILE, "ios/App/App/Policy/SwedebeatSetting.swift"), "utf8");
const TURNED_ON = SWIFT.replace("swedebeatEnabled = false", "swedebeatEnabled = true");
const SWEDEBEAT_DOC = JSON.parse(readFileSync(join(MOBILE, "..", "..", "schema", "class-format", "v1", "examples", "valid", "class-swedebeat-mix.json"), "utf8"));
const ROW = (n: number, source: string, title: string) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, title, minutes: 30, songs: 12, source });
const LIST = { classes: [ROW(1, "swedebeat", "Mix class"), ROW(2, "spotify", "Spotify class"), ROW(3, "local", "Local class")], status: "synced" };
const answers = { listClasses: LIST, syncNow: LIST, getClass: { document: SWEDEBEAT_DOC } };
const SIZES: readonly (readonly [number, number])[] = [[390, 844], [844, 390], [360, 640], [640, 360]];

let browser: Browser;
let off: Awaited<ReturnType<typeof buildSite>>;
let on: Awaited<ReturnType<typeof buildSite>>;
before(async () => {
  off = await buildSite();
  on = await buildSite(TURNED_ON);
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
  off?.remove();
  on?.remove();
});

test("the setting is read from the Swift line: the two sites differ only by it", () => {
  assert.notEqual(TURNED_ON, SWIFT);
});

test("ios, setting off: the dimmed line and row, nothing else, no scroll, text at the status-line tier", async () => {
  for (const size of SIZES) {
    const p = await openPhonePage(browser, off.dir, "instructor.html", size, answers, "ios");
    try {
      await p.page.waitForSelector(".key.row");
      const line = p.page.locator(".swedebeat");
      assert.equal(await line.count(), 1);
      assert.equal(await line.locator(".sw-detail").innerText(), NOT_AVAILABLE);
      const key = line.locator("button");
      assert.equal(await key.getAttribute("aria-disabled"), "true");
      assert.equal(await key.getAttribute("disabled"), null, "the dimmed key stays in the tab order");
      assert.equal(await key.getAttribute("aria-describedby"), await line.locator(".sw-detail").getAttribute("id"));
      const row = p.page.locator(".key.row.dim");
      assert.equal(await row.count(), 1);
      assert.equal(await row.getAttribute("aria-disabled"), "true");
      assert.equal(await row.getAttribute("aria-describedby"), null, "the sentence is read once");
      assert.equal(((await row.innerText()).match(/Not available in this app yet/g) ?? []).length, 1);
      assert.match(await row.innerText(), /Swedebeat, 12 songs/);
      // W11: the text is at the minor tier (never under 12.5 px) and W12: line and first row fit with no scroll.
      for (const sel of [".sw-state", ".sw-detail", ".key.row.dim .sw-msg"]) {
        const px = await p.page.locator(sel).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
        const minor = await p.page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".key .kl")!).fontSize));
        assert.ok(px >= 12.5 && px >= minor - 0.5, `${sel} ${px}px at ${size}`);
      }
      const bottoms = await p.page.evaluate(() => [".swedebeat .sw-detail", ".key.row.dim .sw-msg"].map((s) => document.querySelector(s)!.getBoundingClientRect().bottom <= window.innerHeight));
      assert.deepEqual(bottoms, [true, true], `the message is on screen without a scroll at ${size}`);
      assert.ok((await p.page.evaluate(() => document.documentElement.scrollWidth)) <= size[0]);
      // Pressing the key or the row does nothing and shows nothing; Spotify and local rows are unchanged.
      await key.click({ force: true });
      await row.click({ force: true });
      assert.ok((await p.page.url()).endsWith("instructor.html"));
      assert.deepEqual((await p.native()).map((c) => c[1]).filter((m) => m !== "listClasses" && m !== "syncNow"), []);
      assert.equal(await p.page.locator(".key.row:not(.dim)").count(), 2);
      assert.deepEqual(p.errors, []);
      assert.deepEqual(p.external, []);
      if (size[0] === 390 || size[0] === 844) await shoot(p.page, `swedebeat-ios-list-${size[0]}x${size[1]}`);
    } finally {
      await p.close();
    }
  }
});

test("ios, setting off: a Swedebeat class opened by address never mounts the room, and the list says the one sentence", async () => {
  const p = await openPhonePage(browser, off.dir, `room.html?id=${ID}`, [390, 844], answers, "ios");
  try {
    await p.page.waitForURL((u) => u.pathname.endsWith("/instructor.html"));
    await p.page.waitForSelector(".plate");
    assert.equal(await p.page.locator(".plate").innerText(), NOT_AVAILABLE);
    assert.equal(await p.page.evaluate(() => "room" in window), false);
  } finally {
    await p.close();
  }
});

test("web (not iOS), setting off: nothing dimmed, the Swedebeat row is an ordinary row", async () => {
  const p = await openPhonePage(browser, off.dir, "instructor.html", [390, 844], answers, "web");
  try {
    await p.page.waitForSelector(".key.row");
    assert.equal(await p.page.locator(".swedebeat, .dim").count(), 0);
    assert.equal(await p.page.locator(".key.row").count(), 3);
  } finally {
    await p.close();
  }
});

test("ios, setting on (criterion 3): today's page, and a Swedebeat class opens", async () => {
  const p = await openPhonePage(browser, on.dir, "instructor.html", [390, 844], answers, "ios");
  try {
    await p.page.waitForSelector(".key.row");
    assert.equal(await p.page.locator(".swedebeat, .dim").count(), 0);
    assert.equal(await p.page.locator(".key.row").count(), 3);
  } finally {
    await p.close();
  }
  const room = await openPhonePage(browser, on.dir, `room.html?id=${ID}`, [390, 844], answers, "ios");
  try {
    await room.page.waitForFunction(() => "room" in window);
    assert.ok(room.page.url().includes("room.html"));
  } finally {
    await room.close();
  }
});
