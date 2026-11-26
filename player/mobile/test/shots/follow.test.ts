// Follow the music on the phone's room screen in headless Chrome (issue #872, docs/design/app-follow.md),
// built as shipped and run under its own CSP. Each state of the spec is reached through the band's
// Follow key and the stand-in bridge's scripted answers (phone-page.ts): manual with Follow offered,
// the sheet asking for access, still off after the setting, waiting for the first song, following,
// access taken back ("Following stopped"), and the manual clock again. Pictures at 390x844 and 844x390
// go to screenshots/. No device, no music app, no network.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";
import { classDoc, ID } from "../room-fakes.ts";
import { buildSite, launchChrome, openPhonePage, shoot } from "./phone-page.ts";

const doc = classDoc();
const TITLE = (doc.class as { title: string }).title;
const LIST = { classes: [{ id: ID, title: TITLE, minutes: 45, songs: 11 }], status: "synced" };

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
  link: { mode: string; state: string; announcement: string | null } | null;
  view: { status: string; classMs: number } | null;
  followKey?: boolean;
}
const frameOf = (page: Page): Promise<Frame> => page.evaluate(() => (window as unknown as { room: { state(): Promise<Frame> } }).room.state());

/** Native code's next answer to [method] (defined, not assigned: it may replace `playing`'s getter). */
const answer = (page: Page, method: string, value: unknown): Promise<void> =>
  page.evaluate(
    ([m, v]) => void Object.defineProperty((window as unknown as { __answers: object }).__answers, m as string, { configurable: true, enumerable: true, writable: true, value: v }),
    [method, value] as const,
  );

/** Spotify plays [title] from [fromMs] onwards: each reading gives the position at the page's time. */
const playing = (page: Page, title: string, artist: string, fromMs: number): Promise<void> =>
  page.evaluate(
    ([t, a, from]) => {
      const at = Date.now();
      Object.defineProperty((window as unknown as { __answers: object }).__answers, "reading", {
        configurable: true,
        enumerable: true,
        get: () => ({ state: "reading", reading: { trackId: null, title: t, artist: a, lengthMs: 234_000, playing: true, positionMs: (from as number) + Date.now() - at, ageMs: 0 } }),
      });
    },
    [title, artist, fromMs] as const,
  );

/** Android's setting closed: the app's page is in front again. */
const backFromSetting = (page: Page): Promise<void> => page.evaluate(() => void document.dispatchEvent(new Event("visibilitychange")));

const sheetTitle = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const s = document.querySelector<HTMLElement>(".follow-sheet");
    return s === null || s.hidden ? null : (s.querySelector("h1")?.textContent ?? null);
  });

/** A tap shows the band when it is hidden (a tap on a shown band would hide it). */
async function showBand(page: Page, w: number, h: number): Promise<void> {
  if ((await page.evaluate(() => document.querySelector(".band")?.getAttribute("data-phase"))) !== "hidden") return;
  await page.mouse.click(Math.round(w / 2), Math.round(h / 3));
  await page.clock.runFor(600); // the band is drawn in a frame of its own, at most one each 500 ms
}

/** CSS animations run on real time, not the page's fake clock: the sheet's fade is done before a shot. */
const settled = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));

const bandWords = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".band .btn")].map((e) => e.innerText.replace(/\s+/g, " ").trim()));

for (const size of [[390, 844], [844, 390]] as const) {
  const [w, h] = size;
  test(`${w}x${h}: each follow state of app-follow.md, from Follow to the manual clock again`, async () => {
    const p = await openPhonePage(browser, site.dir, "instructor.html", size, { listClasses: LIST, syncNow: LIST, getClass: { document: doc } });
    try {
      await p.page.click(".row");
      await p.page.waitForSelector(".room");
      await p.page.evaluate(() => document.fonts.ready);
      await p.page.clock.runFor(650);

      // Manual: the band offers Follow; nothing about the music has been asked.
      await showBand(p.page, w, h);
      assert.equal((await bandWords(p.page))[0], "Follow The music");
      assert.deepEqual([(await frameOf(p.page)).link?.mode, (await frameOf(p.page)).followKey], ["manual", true]);
      await shoot(p.page, `follow-manual-${w}x${h}`);

      // Access refused: the sheet asks.
      await answer(p.page, "followAccess", { granted: false });
      await answer(p.page, "openFollowSetting", { opened: true });
      await p.page.click(".band .btn.follow");
      await p.page.clock.runFor(300);
      assert.equal(await sheetTitle(p.page), "Follow the music on this phone");
      await settled(p.page);
      await shoot(p.page, `follow-ask-${w}x${h}`);

      // Back from the setting with access still off: the sheet says how.
      await p.page.click(".follow-sheet [data-action=open_setting]");
      await backFromSetting(p.page);
      await p.page.clock.runFor(300);
      assert.equal(await sheetTitle(p.page), "Notification access is still off");
      await settled(p.page);
      await shoot(p.page, `follow-still-off-${w}x${h}`);

      // Access given in the setting: the sheet closes by itself; following waits for the first song.
      await answer(p.page, "followAccess", { granted: true });
      await answer(p.page, "follow", { state: "following" });
      await answer(p.page, "reading", { state: "nothing" });
      await answer(p.page, "unfollow", { state: "stopped" });
      await answer(p.page, "sendPlay", { state: "sent" });
      await p.page.click(".follow-sheet [data-action=open_setting]");
      await backFromSetting(p.page);
      await p.page.clock.runFor(1_200);
      assert.equal(await sheetTitle(p.page), null);
      let f = await frameOf(p.page);
      assert.deepEqual([f.link?.mode, f.link?.state, f.followKey], ["following", "Manual", false]);
      await shoot(p.page, `follow-waiting-${w}x${h}`);

      // Start asks the music app to play, once; Song 2 plays and the clock locks to it.
      await p.page.evaluate(() => (window as unknown as { room: { start(): Promise<unknown> } }).room.start());
      await p.page.clock.runFor(1_000);
      await playing(p.page, "Song 2", "Artist 2", 5_000);
      await p.page.clock.runFor(3_000);
      f = await frameOf(p.page);
      assert.equal(f.link?.state, "Locked");
      assert.ok(Math.abs((f.view?.classMs ?? 0) - 233_000) < 5_000, `classMs ${f.view?.classMs}`);
      await shoot(p.page, `follow-following-${w}x${h}`);
      await showBand(p.page, w, h);
      await shoot(p.page, `follow-following-band-${w}x${h}`);

      // Access taken back: the clock goes on by hand at once, and says so.
      await answer(p.page, "reading", { state: "noAccess" });
      await p.page.clock.runFor(1_000);
      f = await frameOf(p.page);
      assert.deepEqual([f.link?.mode, f.view?.status, f.followKey], ["manual", "running", true]);
      assert.notEqual(f.link?.announcement ?? null, null);
      await shoot(p.page, `follow-stopped-${w}x${h}`);

      // Thirty seconds on: the manual clock, with Follow offered again.
      await p.page.clock.runFor(31_000);
      f = await frameOf(p.page);
      assert.deepEqual([f.link?.mode, f.link?.state, f.link?.announcement ?? null, f.followKey], ["manual", "Manual", null, true]);
      await showBand(p.page, w, h);
      assert.equal((await bandWords(p.page))[0], "Follow The music");
      await shoot(p.page, `follow-manual-again-${w}x${h}`);

      const asked = (await p.native()).map(([, m]) => String(m));
      assert.equal(asked.filter((m) => m.startsWith("send")).join(), "sendPlay", asked.join());
      assert.equal(await p.page.evaluate(() => document.querySelectorAll("audio, video").length), 0);
      assert.deepEqual(p.errors, []);
      assert.deepEqual(p.external, []);
    } finally {
      await p.close();
    }
  });
}

// A platform with no music reader (ADR 0016, section 5; issue #899): followAccess says `unavailable`,
// so the band has no Follow key, no sheet is ever mounted open and `follow` is never called.
for (const size of [[390, 844], [844, 390]] as const) {
  const [w, h] = size;
  test(`${w}x${h}: no reader on this platform: the manual clock, no Follow`, async () => {
    const answers = { listClasses: LIST, syncNow: LIST, getClass: { document: doc }, followAccess: { granted: false, state: "unavailable" } };
    const p = await openPhonePage(browser, site.dir, "instructor.html", size, answers);
    try {
      await p.page.click(".row");
      await p.page.waitForSelector(".room");
      await p.page.evaluate(() => document.fonts.ready);
      await p.page.clock.runFor(650);
      await showBand(p.page, w, h);
      const words = await bandWords(p.page);
      assert.ok(words.length > 0 && words.every((x) => !x.startsWith("Follow")), words.join("|"));
      assert.equal(await p.page.locator(".band .btn.follow").count(), 0);
      assert.deepEqual([(await frameOf(p.page)).link?.mode, (await frameOf(p.page)).followKey], ["manual", false]);
      await shoot(p.page, `follow-no-reader-${w}x${h}`);
      await p.page.evaluate(() => (window as unknown as { room: { start(): Promise<unknown> } }).room.start());
      await p.page.clock.runFor(2_000);
      assert.equal((await frameOf(p.page)).view?.status, "running");
      assert.equal(await sheetTitle(p.page), null);
      const asked = (await p.native()).map(([, m]) => String(m));
      assert.ok(!asked.includes("follow") && !asked.includes("reading"), asked.join());
      assert.deepEqual(p.errors, []);
      assert.deepEqual(p.external, []);
    } finally {
      await p.close();
    }
  });
}
