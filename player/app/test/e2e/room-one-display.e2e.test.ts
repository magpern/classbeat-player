// With one display the room window fills it, above the presenter (plan section 3, "One screen first";
// class-list.md, "Where the room window goes"), and the room screen's own band runs the class
// (room-2d.md, "Controls on the room screen"): a press on the band reaches the shell and comes back
// as the new state, and End, End class brings the presenter back. Checked on the real screen
// picture, so the stacking order is the system's; pictures go to screenshots/ for the design
// review. Linux only (xvfb, one display, no window manager): there the screen may be read without a
// system prompt; the placement itself is checked on every system by test/unit/room-placement.test.ts.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { APP_DIR, launch, sleep } from "./launch.ts";
import { captureScreen, menu, onPage, openClassFile, theRoom, waitFor, whiteShare, windowCount } from "./room-helpers.ts";

const SHOTS = join(APP_DIR, "screenshots");
let app: ElectronApplication;
let page: Page;

const LINUX = process.platform === "linux";

before(async () => {
  if (!LINUX) return;
  mkdirSync(SHOTS, { recursive: true });
  ({ app, page } = await launch({ page: "list" }));
});
after(async () => {
  await app?.close();
});

/** Opens a class file with the focus in the application or elsewhere; returns both windows and who has the focus. */
async function open(elsewhere = false) {
  await app.evaluate(({ BrowserWindow }, elsewhere) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    // Its light menu bar then lies over a dark part of the room screen (below the zone list,
    // above the band), so the picture tells which window is on top.
    w.setBounds({ x: 600, y: 760, width: 600, height: 240 });
    if (elsewhere) w.blur();
    else w.focus();
  }, elsewhere);
  await sleep(200);
  await openClassFile(app);
  await onPage(page, "presenter.html");
  const room = await theRoom(app);
  await room.waitForSelector(".band");
  await sleep(1000);
  const f = await app.evaluate(({ BrowserWindow, screen }) => {
    const all = BrowserWindow.getAllWindows();
    const r = all.find((x) => x.webContents.getURL().endsWith("/dist/room.html"))!;
    const main = all.find((x) => x !== r)!;
    const focused = BrowserWindow.getFocusedWindow();
    return {
      displays: screen.getAllDisplays().map((d) => d.bounds),
      presenter: main.getBounds(),
      room: r.getBounds(),
      full: r.isFullScreen(),
      focused: focused === main ? "presenter" : focused === null ? "none" : "room",
    };
  });
  return { ...f, page: room };
}

async function backToList(): Promise<void> {
  if ((await windowCount(app)) === 1) return;
  await menu(app, "class-list");
  await onPage(page, "classlist.html");
  await waitFor(async () => (await windowCount(app)) === 1, 5000, "the room window to close");
}

/** The presenter window's light menu bar: on screen only while nothing covers the presenter. */
const menuBar = (b: { x: number; y: number; width: number }) => ({ x: b.x + 2, y: b.y + 2, width: b.width - 4, height: 18 });
const word = (room: Page, id: string): Promise<string | null> => room.locator(`.band [data-id="${id}"] .w`).textContent();

test("one display: the room window fills it, above the presenter, with the band up before the start", async (t) => {
  if (!LINUX) return t.skip("Linux under xvfb only");
  const f = await open();
  if (f.displays.length !== 1) return t.skip("needs one display");
  assert.equal(f.full, true);
  // Full screen on the display; xvfb with no window manager gives it one pixel less on each far side.
  const d = f.displays[0]!;
  assert.deepEqual([f.room.x, f.room.y], [d.x, d.y]);
  assert.ok(d.width - f.room.width <= 1 && d.height - f.room.height <= 1, `${JSON.stringify(f.room)} fills ${JSON.stringify(d)}`);
  assert.equal(f.focused, "room", "the application had the focus: the room takes it, so its keys work");
  assert.equal(await f.page.evaluate(() => document.querySelector<HTMLElement>(".band")?.dataset.phase), "shown");
  assert.equal(await word(f.page, "main"), "Start");
  const s = await captureScreen(app);
  writeFileSync(join(SHOTS, "room-window-one-display.png"), s.png);
  assert.ok(whiteShare(s, menuBar(f.presenter)) < 0.05, "the room screen covers the presenter");
  await backToList();
});

test("a press on the band reaches the shell and comes back as the new state; Space does too, without showing the band", async (t) => {
  if (!LINUX) return t.skip("Linux under xvfb only");
  const f = await open();
  if (f.displays.length !== 1) return t.skip("needs one display");
  await f.page.locator('.band [data-id="main"]').click();
  await waitFor(async () => (await word(f.page, "main")) === "Pause", 5000, "the band to say Pause");
  // Let the band hide (running, one display: it is not held), then pause with Space.
  await waitFor(async () => (await f.page.evaluate(() => document.querySelector<HTMLElement>(".band")?.dataset.phase)) === "hidden", 6000, "the band to hide");
  await f.page.keyboard.press(" ");
  await waitFor(async () => (await word(f.page, "main")) === "Resume", 5000, "the band to say Resume");
  assert.equal(await f.page.evaluate(() => document.querySelector<HTMLElement>(".band")?.dataset.phase), "hidden");
  await backToList();
});

test("End, then End class: the room window closes and the presenter is back on the class list", async (t) => {
  if (!LINUX) return t.skip("Linux under xvfb only");
  const f = await open();
  if (f.displays.length !== 1) return t.skip("needs one display");
  await f.page.keyboard.press("End");
  await f.page.locator('.band [data-id="end-class"]').click();
  await onPage(page, "classlist.html");
  await waitFor(async () => (await windowCount(app)) === 1, 5000, "the room window to close");
  await sleep(500);
  const s = await captureScreen(app);
  writeFileSync(join(SHOTS, "room-window-one-display-ended.png"), s.png);
  const presenter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds());
  assert.ok(whiteShare(s, menuBar(presenter)) > 0.8, "the presenter is on screen again");
});

test("the class opens while another application has the focus: the room fills the display but takes no focus", async (t) => {
  if (!LINUX) return t.skip("Linux under xvfb only");
  const f = await open(true);
  if (f.displays.length !== 1) return t.skip("needs one display");
  assert.equal(f.full, true);
  assert.equal(f.focused, "none", "the other application keeps the focus");
  await backToList();
});
