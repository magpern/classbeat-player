// With one display the room window is a rehearsal window that never covers the presenter or its
// controls (#149, N1; core/room/placement.ts): in the largest free part beside, below or above it,
// or, with no free room for the minimum, under the presenter, which the shell keeps on top. Checked
// on the real screen picture, so the stacking order is the system's. The pictures are written to
// screenshots/ for the design review. Linux only (xvfb, one display, no window manager): there the
// bounds asked for are the bounds given and the screen may be read without a system prompt; the
// placement itself is checked on every system by test/unit/room-placement.test.ts.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { placeRoom } from "../../src/core/room/placement.ts";
import type { DisplayFacts, Rect } from "../../src/core/room/placement.ts";
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

const overlap = (a: Rect, b: Rect): Rect => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
};

/**
 * Moves the presenter, opens a class file and returns where both windows are, where the rule put
 * the room, how often the presenter was raised and which window has the focus. `elsewhere`: the
 * focus is in another application (the presenter is blurred) when the class opens.
 */
async function openWithPresenterAt(bounds: Rect | "centre", elsewhere = false) {
  await app.evaluate(({ BrowserWindow }, { b, elsewhere }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    if (b === "centre") w.center();
    else w.setBounds(b);
    const g = globalThis as unknown as { raised: number; moveTop?: () => void };
    g.raised = 0;
    g.moveTop ??= w.moveTop.bind(w);
    w.moveTop = () => {
      g.raised++;
      g.moveTop!();
    };
    if (elsewhere) w.blur();
    else w.focus();
  }, { b: bounds, elsewhere });
  await sleep(200);
  await openClassFile(app);
  await onPage(page, "presenter.html");
  await theRoom(app);
  await sleep(1000);
  const f = await app.evaluate(({ BrowserWindow, screen }) => {
    const all = BrowserWindow.getAllWindows();
    const room = all.find((x) => x.webContents.getURL().endsWith("/dist/room.html"))!;
    const main = all.find((x) => x !== room)!;
    return {
      displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea })),
      presenter: main.getBounds(),
      presenterDisplay: screen.getDisplayMatching(main.getBounds()).id,
      room: room.getBounds(),
      full: room.isFullScreen(),
      raised: (globalThis as unknown as { raised: number }).raised,
      focused: BrowserWindow.getFocusedWindow() === main ? "presenter" : BrowserWindow.getFocusedWindow() === null ? "none" : "room",
    };
  });
  const want = placeRoom(f.displays as DisplayFacts[], f.presenterDisplay, f.presenter as Rect, null);
  assert.ok(want);
  return { ...f, want };
}

async function backToList(): Promise<void> {
  await menu(app, "class-list");
  await onPage(page, "classlist.html");
  await waitFor(async () => (await windowCount(app)) === 1, 5000, "the room window to close");
}

test("one display with free room below the presenter: the room window is there, clear of the presenter", async (t) => {
  if (!LINUX) return t.skip("Linux under xvfb only");
  const f = await openWithPresenterAt({ x: 0, y: 0, width: 1000, height: 720 });
  if (f.displays.length !== 1) return t.skip("needs one display");
  assert.equal(f.full, false);
  assert.equal(f.want.behindPresenter, false);
  assert.deepEqual(f.room, f.want.bounds);
  assert.equal(f.raised, 0, "nothing overlaps: the presenter is not raised");
  assert.equal(overlap(f.room, f.presenter).width * overlap(f.room, f.presenter).height, 0, `${JSON.stringify(f.room)} over ${JSON.stringify(f.presenter)}`);
  const s = await captureScreen(app);
  writeFileSync(join(SHOTS, "room-window-shared-beside.png"), s.png);
  assert.ok(whiteShare(s, f.presenter) > 0.5, "the presenter is all on screen");
  assert.ok(whiteShare(s, f.room) < 0.2, "the room screen is drawn in its window");
  await backToList();
});

test("one display with no free room: the room window goes under the presenter, which stays on top", async (t) => {
  if (!LINUX) return t.skip("Linux under xvfb only");
  const f = await openWithPresenterAt("centre");
  if (f.displays.length !== 1) return t.skip("needs one display");
  assert.equal(f.want.behindPresenter, true, `no free part for the minimum: ${JSON.stringify(f)}`);
  assert.deepEqual(f.room, f.want.bounds);
  const both = overlap(f.room, f.presenter);
  assert.ok(both.width * both.height > 0, "they overlap");
  assert.ok(f.raised > 0, "the presenter is raised");
  assert.equal(f.focused, "presenter", "the application had the focus: the presenter keeps it");
  const s = await captureScreen(app);
  writeFileSync(join(SHOTS, "room-window-shared-under.png"), s.png);
  // Where both are, the screen shows the presenter's page (white), not the room screen (dark).
  assert.ok(whiteShare(s, both) > 0.8, `the presenter covers the room window: ${whiteShare(s, both)}`);
  await backToList();
});

test("the class opens while another application has the focus: the presenter is raised but takes no focus", async (t) => {
  if (!LINUX) return t.skip("Linux under xvfb only");
  const beside = await openWithPresenterAt({ x: 0, y: 0, width: 1000, height: 720 }, true);
  assert.equal(beside.want.behindPresenter, false);
  assert.deepEqual([beside.raised, beside.focused], [0, "none"], "beside: nothing raised, no focus taken");
  await backToList();
  const under = await openWithPresenterAt("centre", true);
  assert.equal(under.want.behindPresenter, true);
  assert.ok(under.raised > 0, "under: the presenter is raised");
  assert.equal(under.focused, "none", "under: the other application keeps the focus");
  await backToList();
});
