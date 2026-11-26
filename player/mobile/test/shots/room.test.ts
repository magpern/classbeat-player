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

/** The band is shown, and every one of its keys (and the End question) lies whole inside the viewport, none over another. */
async function bandInView(page: Page, w: number, h: number, words: string[]): Promise<void> {
  const shown = await page.evaluate(() => document.querySelector(".band")?.getAttribute("data-phase"));
  assert.notEqual(shown, "hidden");
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".band .btn, .band .q")].map((e) => {
      const r = e.getBoundingClientRect();
      return { t: e.innerText.replace(/\s+/g, " ").trim(), l: r.left, r: r.right, t0: r.top, b: r.bottom };
    }),
  );
  assert.deepEqual(boxes.map((b) => b.t), words);
  for (const b of boxes) assert.ok(b.l >= 0 && b.r <= w && b.t0 >= 0 && b.b <= h, `${b.t} outside ${w}x${h}: ${JSON.stringify(b)}`);
  for (const a of boxes) for (const b of boxes) {
    if (a !== b) assert.ok(a.r <= b.l || b.r <= a.l || a.b <= b.t0 || b.b <= a.t0, `${a.t} overlaps ${b.t}`);
  }
  // Upright, each key is a touch target of at least 64 x 64 CSS px (play.md, "Portrait"); on its side
  // the band is the desktop's, unchanged.
  if (h < w) return;
  for (const b of boxes.filter((x) => !x.t.endsWith("?"))) assert.ok(b.r - b.l >= 64 && b.b - b.t0 >= 64, `${b.t} under 64 px`);
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

      // A tap shows the band over the score's box: every key in sight.
      await p.page.mouse.click(Math.round(w / 2), Math.round(h / 3));
      await p.page.clock.runFor(100);
      await bandInView(p.page, w, h, ["Previous Interval", "Pause", "Next Interval", "End"]);
      await fitsAcross(p.page, w);
      if (kept) await shoot(p.page, `room-running-band-${w}x${h}`);
      // End asks first, and its question and both answers are in sight.
      await p.page.click(".band .quit");
      await p.page.clock.runFor(600); // the question is a change of its own: a frame 500 ms after the band's
      await bandInView(p.page, w, h, ["End the class?", "End class Back to the class list", "Keep going"]);
      await fitsAcross(p.page, w);
      if (kept) await shoot(p.page, `room-running-end-${w}x${h}`);

      // The phone page has no media element at all (rule 3), and the room screen runs without one.
      assert.equal(await p.page.evaluate(() => document.querySelectorAll("audio, video").length), 0);
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

for (const [why, answer] of PLATES) for (const size of KEPT) {
  const [w, h] = size;
  test(`${w}x${h}: a class that is ${why} goes back to the list's plate, and no room screen is drawn`, async () => {
    const p = await openPhonePage(browser, site.dir, `room.html?id=${ID}`, size, answers(answer));
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
