// The phone's room screen in headless Chrome (issue #871), built as shipped and run under its own CSP:
// the class picked on the class list opens and shows its first interval before Start, then runs on
// the manual clock; a class that is missing, unreadable or of a newer format goes back to the list's
// plate. Pictures at the app's sizes go to screenshots/ (390x844 and 844x390); the other sizes are
// checked only. The bridge is a stand-in (phone-page.ts): no device, no network.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";
import { classDoc, ID } from "../room-fakes.ts";
import { PLATE_WORDS, type NoClass } from "../../src/room/plate-words.ts";
import { buildSite, launchChrome, openPhonePage, shoot, type Answers } from "./phone-page.ts";

const KEPT: readonly (readonly [number, number])[] = [
  [390, 844],
  [844, 390],
];
const CHECKED: readonly (readonly [number, number])[] = [
  [360, 640],
  [640, 360],
  [768, 1024],
  [1024, 768],
];

const doc = classDoc();
const TITLE = (doc.class as { title: string }).title;
const LIST = { classes: [{ id: ID, title: TITLE, minutes: 45, songs: 11 }], status: "synced" };
const answers = (getClass: unknown): Answers => ({ listClasses: LIST, syncNow: LIST, getClass });

let browser: Browser;
let site: Awaited<ReturnType<typeof buildSite>>;

before(async () => {
  site = await buildSite();
  browser = await launchChrome();
});

after(async () => {
  await browser?.close();
  site?.remove();
});

interface Frame {
  doc: { class: { title: string } } | null;
  view: { status: string; intervalIndex: number; classMs: number } | null;
}
const frameOf = (page: Page): Promise<Frame> => page.evaluate(() => (window as unknown as { room: { state(): Promise<Frame> } }).room.state());

/** No sideways scroll, and every element of the screen inside the viewport's width. */
async function fitsAcross(page: Page, width: number): Promise<void> {
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(scroll <= width, `scrolls sideways: ${scroll} > ${width}`);
}

for (const size of [...KEPT, ...CHECKED]) {
  const [w, h] = size;
  const kept = KEPT.includes(size);
  test(`${w}x${h}: the class opened from the list shows its first interval before Start, then runs`, async () => {
    const p = await openPhonePage(browser, site.dir, "instructor.html", size, answers({ document: doc }));
    try {
      await p.page.click(".row");
      await p.page.waitForSelector(".room");
      await p.page.evaluate(() => document.fonts.ready);
      await p.page.clock.runFor(650);
      assert.equal(new URL(p.page.url()).search, `?id=${ID}`);
      assert.deepEqual((await p.native()).filter(([, m]) => m === "getClass"), [["InstructorMode", "getClass", { id: ID }]]);
      const ready = await frameOf(p.page);
      assert.equal(ready.doc?.class.title, TITLE);
      assert.deepEqual([ready.view?.status, ready.view?.intervalIndex, ready.view?.classMs], ["ready", 0, 0]);
      await fitsAcross(p.page, w);
      if (kept) await shoot(p.page, `room-before-start-${w}x${h}`);

      await p.page.evaluate(() => (window as unknown as { room: { start(): Promise<unknown> } }).room.start());
      await p.page.clock.runFor(95_000);
      const running = await frameOf(p.page);
      assert.equal(running.view?.status, "running");
      assert.ok((running.view?.classMs ?? 0) >= 90_000, `classMs ${running.view?.classMs}`);
      await fitsAcross(p.page, w);
      if (kept) await shoot(p.page, `room-running-${w}x${h}`);

      // The mix's element is there for the room screen's module, but nothing gave it a source.
      assert.deepEqual(await p.page.evaluate(() => [...document.querySelectorAll("audio")].map((a) => [a.id, a.currentSrc, a.paused])), [["mix", "", true]]);
      // The checked class ran in the page under its CSP: no error, and nothing left the files.
      assert.deepEqual(p.errors, []);
      assert.deepEqual(p.external, []);
    } finally {
      await p.close();
    }
  });
}

const PLATES: readonly [NoClass, unknown][] = [
  ["missing", { error: "not_found" }],
  ["invalid", { document: { ...doc, intervals: "none" } }],
  ["newer", { document: { ...doc, format_version: "2.0" } }],
];

for (const [why, answer] of PLATES) {
  test(`a class that is ${why} goes back to the list's plate, and no room screen is drawn`, async () => {
    const [w, h] = KEPT[0];
    const p = await openPhonePage(browser, site.dir, `room.html?id=${ID}`, KEPT[0], answers(answer));
    try {
      await p.page.waitForURL((u) => u.pathname.endsWith("/instructor.html"));
      await p.page.waitForSelector(".plate");
      const words = PLATE_WORDS[why];
      assert.deepEqual(await p.page.locator(".plate span").allTextContents(), [words.head, words.detail]);
      await p.page.waitForSelector(".row");
      await p.page.evaluate(() => document.fonts.ready);
      assert.equal(await p.page.locator(".room").count(), 0);
      assert.equal(await p.page.evaluate(() => "room" in window), false);
      await shoot(p.page, `room-plate-${why}-${w}x${h}`);
      assert.deepEqual(p.errors, []);
      assert.deepEqual(p.external, []);
    } finally {
      await p.close();
    }
  });
}
