// The presenter's music files notice on the real page (docs/design/music-files.md, "Presenter window,
// during a class"; #922): the plate appears in one frame with its words, Close and Esc close it, it
// does not come back for the class (not on the next push, and not with the same failure again), the
// music line keeps the fact, and a class with no notice shows nothing. Headless Chrome; no Electron,
// no network. Needs `npm run build`.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";
import { musicNoticeOf } from "../../src/core/music-files/music-notice.ts";
import type { MusicNotice } from "../../src/core/music-files/music-notice.ts";
import type { Snapshot } from "../../src/core/snapshot.ts";
import { PAIRED } from "../unit/list-fixtures.ts";
import { started } from "../unit/live-relay.ts";
import { APP_DIR, launchChrome } from "./page.ts";
import { join } from "node:path";

const STUB = `
  window.player = {
    getState: () => Promise.resolve(window.__state),
    command: () => Promise.resolve(window.__state),
    openDropped: () => Promise.resolve(window.__state),
    onUpdate: (cb) => { window.__push = cb; },
    startPairing: () => Promise.resolve(window.__pairing),
    pairingState: () => Promise.resolve(window.__pairing),
    reopenPairingPage: () => Promise.resolve(window.__pairing),
    unpair: () => Promise.resolve(window.__pairing),
    liveView: () => Promise.resolve(null), startLive: () => Promise.resolve(null), endLive: () => Promise.resolve(null),
    makeControlCode: () => Promise.resolve(null), dropPhone: () => Promise.resolve(null),
    riders: () => Promise.resolve(null), dropRider: () => Promise.resolve(null), lockJoining: () => Promise.resolve(null), newJoinCode: () => Promise.resolve(null),
  };
`;

let browser: Browser;
let base: Snapshot;
before(async () => {
  browser = await launchChrome();
  base = (await started()).controller.snapshot();
});
after(async () => {
  await browser?.close();
});

const STOPPED = musicNoticeOf({ reason: "failed" }, { song: 0, why: "read" }, "Neon Avenue")!;

async function open(music: MusicNotice | null): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(STUB);
  await context.addInitScript(`Object.assign(window, ${JSON.stringify({ __state: { ...base, music }, __pairing: PAIRED })});`);
  const page = await context.newPage();
  await page.goto(`file://${join(APP_DIR, "dist", "presenter.html")}`);
  await page.waitForSelector("#clock:not([hidden])");
  return { page, close: () => context.close() };
}
const push = (page: Page, music: MusicNotice | null, loadId?: number): Promise<void> =>
  page.evaluate(({ m, l }) => void (window as unknown as { __push: (s: unknown) => void; __state: { loadId: number } }).__push({ ...(window as unknown as { __state: object }).__state, music: m, loadId: l ?? (window as unknown as { __state: { loadId: number } }).__state.loadId }), { m: music, l: loadId });
const shown = (page: Page, id: string): Promise<boolean> => page.evaluate((i) => !document.getElementById(i)!.hidden, id);

test("a failure shows the music line, the song and the plate, with the plate a polite status", async () => {
  const { page, close } = await open(STOPPED);
  try {
    assert.equal(await page.locator("#music-line").textContent(), "Manual clock, music stopped");
    assert.equal(await page.locator("#music-detail").textContent(), "Neon Avenue could not be played");
    assert.equal(await page.locator("#music-plate-headline").textContent(), "The music stopped");
    assert.equal(await page.locator("#music-plate-body").textContent(), "Neon Avenue could not be read. The clock keeps running.");
    assert.equal(await page.locator("#music-plate").getAttribute("role"), "status");
  } finally {
    await close();
  }
});

test("Close closes the plate for the class; the line keeps the fact and the plate does not come back on later pushes", async () => {
  const { page, close } = await open(STOPPED);
  try {
    await page.click("#music-close");
    assert.equal(await shown(page, "music-plate"), false);
    assert.equal(await page.locator("#music-line").textContent(), "Manual clock, music stopped");
    assert.equal(await shown(page, "music-detail"), true);
    await push(page, STOPPED);
    await push(page, { ...STOPPED });
    assert.equal(await shown(page, "music-plate"), false, "not on the next push");
  } finally {
    await close();
  }
});

test("Esc closes the plate; with no plate Esc does nothing here", async () => {
  const { page, close } = await open(STOPPED);
  try {
    // A listener added later, as the riders panel's is, never sees the press that closed the plate.
    await page.evaluate(() => void ((window as unknown as { __esc: number }).__esc = 0, document.addEventListener("keydown", (e) => e.key === "Escape" && (window as unknown as { __esc: number }).__esc++)));
    await page.keyboard.press("Escape");
    assert.equal(await shown(page, "music-plate"), false);
    assert.equal(await page.evaluate(() => (window as unknown as { __esc: number }).__esc), 0);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => (window as unknown as { __esc: number }).__esc), 1, "with no plate Esc goes on to the others");
  } finally {
    await close();
  }
  const quiet = await open(musicNoticeOf({ reason: "missing", missing: [1, 4] }, null, null));
  try {
    assert.equal(await shown(quiet.page, "music-plate"), false, "a choice made before the start is not a fault: no plate");
    assert.equal(await quiet.page.locator("#music-line").textContent(), "Manual clock");
    assert.equal(await quiet.page.locator("#music-detail").textContent(), "2 music files were missing when the class started");
  } finally {
    await quiet.close();
  }
});

test("a class with no notice shows nothing; another class's failure shows its plate again", async () => {
  const { page, close } = await open(null);
  try {
    assert.equal(await shown(page, "music"), false);
    await push(page, STOPPED);
    assert.equal(await shown(page, "music-plate"), true);
    await page.click("#music-close");
    await push(page, STOPPED, base.loadId + 1);
    assert.equal(await shown(page, "music-plate"), true, "a new class is a new run");
    await push(page, null);
    assert.equal(await shown(page, "music"), false);
  } finally {
    await close();
  }
});
