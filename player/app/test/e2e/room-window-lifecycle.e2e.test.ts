// The room window's life after it opened (#149): the class ends while the instructor is on the
// class list, and the window closes then (N3, as behaviour, not on the source); a room window
// closed by hand comes back from the presenter's File > Show the room screen, with the same
// hardening, for a class from a file too (N2). Built app, fake backend on loopback, no network.
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { ROOM_CSP } from "../../src/main/web-preferences.ts";
import { document as classDocument, ID_A } from "../unit/sync-fixtures.ts";
import { launch, sleep } from "./launch.ts";
import { startBackend } from "./room-backend.ts";
import { closeRoomByHand, menu, onPage, openClassFile, roomPage, theRoom, waitFor, windowCount, within } from "./room-helpers.ts";

const TITLE = "Room window lifecycle";
/** Each test's own limit, so a hang fails that test by name instead of the whole CI job. */
const T = { timeout: 60_000 };
let server: Server;
let app: ElectronApplication;
let page: Page;

before(async () => {
  let origin: string;
  ({ server, origin } = await startBackend(classDocument(TITLE)));
  ({ app, page } = await launch({ page: "list", args: ["--test-memory-keychain"], env: { PLAYER_BACKEND_ORIGIN: origin } }));
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => undefined;
  });
}, T);
after(async () => {
  await app?.close();
  server?.closeAllConnections();
  server?.close();
}, T);

interface Shown {
  view: { status: string; classRemainingMs: number } | null;
}
const command = (cmd: object): Promise<Shown | null> => page.evaluate((c) => (window as unknown as { player: { command(c: unknown): Promise<Shown | null> } }).player.command(c), cmd);
const startFromList = async (): Promise<void> => {
  await page.waitForSelector(`#list [data-id="${ID_A}"]`, { timeout: 30_000 });
  await page.waitForSelector('footer [data-action="start"]');
  await page.locator('footer [data-action="start"]').click();
  await onPage(page, "presenter.html");
};

/** What the reopened window is: the room page, its policy, its preload and its preferences. */
async function hardening(room: Page) {
  // macOS has one menu bar for the application, not one per window: there the room window's own
  // menu (removed with removeMenu) cannot be read from isMenuBarVisible.
  const prefs = await within(10_000, "read the room window's preferences", app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith("/dist/room.html"))!;
    const p = (w.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> | null }).getLastWebPreferences() ?? {};
    return { ci: p.contextIsolation, ni: p.nodeIntegration, sb: p.sandbox, wv: p.webviewTag, ws: p.webSecurity, ownMenu: process.platform !== "darwin" && w.isMenuBarVisible() };
  }));
  const page = await within(10_000, "read the room page", room.evaluate(() => ({
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
    require: typeof (globalThis as Record<string, unknown>).require,
    player: typeof (window as unknown as { player?: unknown }).player,
    api: Object.keys((window as unknown as { room: object }).room).sort(),
  })));
  return { prefs, page };
}
const roomItemEnabled = (): Promise<boolean | undefined> =>
  within(10_000, "read Show the room screen", app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("show-room")?.enabled));

const HARDENED = {
  prefs: { ci: true, ni: false, sb: true, wv: false, ws: true, ownMenu: false },
  page: { csp: ROOM_CSP, require: "undefined", player: "undefined", api: ["back", "endClass", "follow", "forward", "next", "onRemote", "onUpdate", "pause", "previous", "remoteState", "resume", "start", "startRemote", "state", "stopRemote", "undo"] },
};

test("the class ends while the instructor is on the class list: the room window closes then", T, async () => {
  await page.waitForSelector('#app[data-body="not-paired"]');
  assert.equal(await roomItemEnabled(), false, "no class open: Show the room screen is off");
  await page.locator('[data-action="pair"]').first().click();
  await startFromList();
  assert.equal(await roomItemEnabled(), true, "a class open: on");
  await theRoom(app);
  await command({ type: "start" });
  // Close to the end, running: about 3 s left.
  let left: Shown["view"] = null;
  for (let i = 0; i < 1000; i++) {
    left = (await command({ type: "jump", deltaMs: 5000 }))?.view ?? null;
    if ((left?.classRemainingMs ?? 0) <= 8000) break;
  }
  assert.equal(left?.status, "running");
  if (left.classRemainingMs > 3000) await command({ type: "jump", deltaMs: left.classRemainingMs - 3000 });
  await menu(app, "class-list");
  await onPage(page, "classlist.html");
  await page.waitForSelector('footer [data-action="back"]');
  assert.equal(await windowCount(app), 2, "the pinned class can be gone back to: the room stays");
  assert.equal(await roomItemEnabled(), true, "on the list, pinned: still on");
  // The clock runs out on its own while the list shows: the pin ends and the room window goes.
  await waitFor(async () => (await windowCount(app)) === 1, 15_000, "the room window to close at the end");
  await page.waitForSelector('footer [data-action="start"]');
  assert.equal(await roomItemEnabled(), false, "the class is closed: off");
});

test("a pinned class: the room window closed by hand comes back from the presenter's menu", T, async () => {
  await startFromList();
  await theRoom(app);
  await closeRoomByHand(app);
  await waitFor(async () => (await windowCount(app)) === 1, 5000, "the room window to close by hand");
  await menu(app, "show-room");
  const room = await theRoom(app);
  await room.waitForFunction((t) => document.querySelector(".intro h1")?.textContent === t, TITLE);
  assert.deepEqual(await hardening(room), HARDENED);
  await menu(app, "show-room");
  await sleep(300);
  assert.equal(await windowCount(app), 2, "one room window, not two");
  // Leaving the class: on the list the pin holds, so the room stays; the presenter closes nothing.
  await menu(app, "class-list");
  await onPage(page, "classlist.html");
  await page.waitForSelector('footer [data-action="back"]');
  await page.locator('footer [data-action="back"]').click();
  await onPage(page, "presenter.html");
});

test("a class from a file: the room window closed by hand comes back, with the same hardening; not once the class is closed", T, async () => {
  const title = await openClassFile(app);
  await onPage(page, "presenter.html");
  let room = await theRoom(app);
  await room.waitForFunction((t) => document.querySelector(".intro h1")?.textContent === t, title);
  await closeRoomByHand(app);
  await waitFor(async () => roomPage(app) === undefined && (await windowCount(app)) === 1, 5000, "the room window to close by hand");
  const shortcut = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("show-room")?.accelerator);
  assert.equal(shortcut, "CmdOrCtrl+Shift+R");
  await menu(app, "show-room");
  room = await theRoom(app);
  await room.waitForFunction((t) => document.querySelector(".intro h1")?.textContent === t, title);
  assert.deepEqual(await hardening(room), HARDENED);
  // On the class list a file class is closed: the window goes, and the menu does not bring it back.
  await menu(app, "class-list");
  await onPage(page, "classlist.html");
  await waitFor(async () => (await windowCount(app)) === 1, 5000, "the room window to close");
  assert.equal(await roomItemEnabled(), false, "the file class is closed: off");
  await menu(app, "show-room");
  await sleep(500);
  assert.equal(await windowCount(app), 1, "no class open: nothing to show");
});

test("Show the room screen right after Class list, before the list page has loaded, opens nothing", T, async () => {
  await openClassFile(app);
  await onPage(page, "presenter.html");
  await theRoom(app);
  await closeRoomByHand(app);
  await waitFor(async () => (await windowCount(app)) === 1, 5000, "the room window to close by hand");
  assert.equal(await roomItemEnabled(), true);
  // Both in one turn of the main process: the list's load has started, not committed.
  const sameTurn = await app.evaluate(({ Menu, BrowserWindow }) => {
    const m = Menu.getApplicationMenu()!;
    const main = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().endsWith("/dist/room.html"))!;
    m.getMenuItemById("class-list")!.click();
    const before = main.webContents.getURL();
    m.getMenuItemById("show-room")!.click();
    return before;
  });
  assert.match(sameTurn, /\/presenter\.html$/, "the list had not committed yet");
  await onPage(page, "classlist.html");
  await sleep(1000);
  assert.equal(await windowCount(app), 1, "the room window stays closed");
  assert.equal(await roomItemEnabled(), false);
});
