// The class list's footer line "Starting opens the room screen and the presenter window" is true
// (issue #141): the built app, paired against a fake backend on loopback (no network), syncs one
// class; Start opens the room screen in its own hardened window, on the display the rule picks,
// and the presenter in the main window. The room window stays while the class can be gone back
// to, and closes with the class: on the class list once no class is pinned, or with the presenter.
// With the room window's screenshots written to screenshots/ for the design review.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { placeRoom } from "../../src/core/room/placement.ts";
import type { DisplayFacts, Rect } from "../../src/core/room/placement.ts";
import { ROOM_CSP, secureWebPreferences } from "../../src/main/web-preferences.ts";
import { converterExamples } from "../unit/fixtures.ts";
import { document as classDocument, ID_A } from "../unit/sync-fixtures.ts";
import { APP_DIR, launch, sleep } from "./launch.ts";
import { startBackend } from "./room-backend.ts";

const TITLE = "Room window spin";
const DOC = classDocument(TITLE);
const SHOTS = join(APP_DIR, "screenshots");
const FOOTER_LINE = "Starting opens the room screen and the presenter window";

let server: Server;
let origin = "";
let app: ElectronApplication;
let page: Page;
let closed = false;

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  ({ server, origin } = await startBackend(DOC));
  ({ app, page } = await launch({ page: "list", args: ["--test-memory-keychain"], env: { PLAYER_BACKEND_ORIGIN: origin } }));
  app.on("close", () => void (closed = true));
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => undefined;
  });
});
after(async () => {
  if (!closed) await app?.close();
  server?.closeAllConnections();
  server?.close();
});

async function waitFor(cond: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(100);
  }
  assert.fail(`timed out waiting for ${what}`);
}

const windowCount = (): Promise<number> => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const roomPage = (): Page | undefined => app.windows().find((w) => !w.isClosed() && w.url().endsWith("/dist/room.html"));
async function theRoom(): Promise<Page> {
  await waitFor(async () => roomPage() !== undefined, 10_000, "the room window");
  const room = roomPage()!;
  await room.waitForLoadState("domcontentloaded");
  return room;
}
const menu = (id: string): Promise<void> => app.evaluate(({ Menu }, i) => Menu.getApplicationMenu()?.getMenuItemById(i)?.click(), id);
const command = (cmd: object): Promise<{ view: { status: string } | null } | null> =>
  page.evaluate((c) => (window as unknown as { player: { command(c: unknown): Promise<{ view: { status: string } | null } | null> } }).player.command(c), cmd);
const onPage = (name: string): Promise<unknown> => page.waitForFunction((n) => location.pathname.endsWith(`/${n}`), name);

/** A screenshot of the room window at a room size, for the Designer. Windowed only: a full-screen room keeps its display's size. */
async function shot(room: Page, name: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith("/dist/room.html"));
    if (w && !w.isFullScreen()) w.setContentSize(1280, 720);
  });
  await sleep(400);
  await room.screenshot({ path: join(SHOTS, `room-window-${name}.png`) });
}

test("paired against the fake backend, the class list shows the synced class with the footer line", async () => {
  await page.waitForSelector('#app[data-body="not-paired"]');
  await page.locator('[data-action="pair"]').first().click();
  await page.waitForSelector(`#list [data-id="${ID_A}"]`, { timeout: 30_000 });
  await page.waitForSelector('footer [data-action="start"]');
  assert.equal(await page.locator("footer .dt").innerText(), FOOTER_LINE);
  assert.equal(await windowCount(), 1, "nothing opens before Start");
});

test("Start opens the room screen in its own window and the presenter in this one", async () => {
  await page.locator('footer [data-action="start"]').click();
  await onPage("presenter.html");
  await page.waitForFunction((t) => document.getElementById("title")?.textContent === t, TITLE);
  const room = await theRoom();
  assert.equal(await windowCount(), 2);
  // The room screen in its "before the start" state: the class's title, the lights down on the first zone.
  await room.waitForFunction((t) => document.querySelector(".intro h1")?.textContent === t, TITLE);
  assert.equal(await room.locator(".gel .lbl").first().textContent(), "First zone");
  assert.equal(await room.title(), "Room screen");
  await shot(room, "before-start");
});

test("the room window is hardened: its own policy and preload, no Node, no network, no navigation, no new window", async () => {
  const room = roomPage()!;
  assert.equal(await room.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")), ROOM_CSP);
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith("/dist/room.html"))!;
    const p = (w.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> | null }).getLastWebPreferences() ?? {};
    return { ci: p.contextIsolation, ni: p.nodeIntegration, sb: p.sandbox, wv: p.webviewTag, ws: p.webSecurity };
  });
  assert.deepEqual(prefs, { ci: true, ni: false, sb: true, wv: false, ws: true });
  // Electron does not report the preload; the room API below is the room preload's, and only it.
  const r = await room.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>).require,
    process: typeof (globalThis as Record<string, unknown>).process,
    player: typeof (window as unknown as { player?: unknown }).player,
    api: Object.keys((window as unknown as { room: object }).room).sort(),
  }));
  assert.deepEqual(r, { require: "undefined", process: "undefined", player: "undefined", api: ["back", "endClass", "follow", "forward", "next", "onRemote", "onUpdate", "pause", "previous", "remoteState", "resume", "start", "startRemote", "state", "stopRemote", "undo"] });
  assert.equal(await room.evaluate(async () => fetch("https://example.invalid/").then(() => "fetched", () => "blocked")), "blocked");
  const fonts = await room.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family).join(",");
  });
  assert.ok(fonts.includes("Atkinson Hyperlegible") && fonts.includes("Big Shoulders Display"), fonts);
  const url = room.url();
  await room.evaluate(() => void (window.location.href = "https://example.invalid/"));
  await sleep(500);
  assert.equal(room.url(), url);
  assert.equal(await room.evaluate(() => window.open("https://example.invalid/") === null), true);
  assert.equal(await windowCount(), 2);
});

test("the room page's channel answers only the room window: the same preload and page elsewhere get null", async () => {
  const preload = join(APP_DIR, "dist", "room-preload.cjs");
  const file = join(APP_DIR, "dist", "room.html");
  const got = await app.evaluate(
    async ({ BrowserWindow }, { secure, file }) => {
      // The room's own hardening, so only the sender differs (a loose window is refused anyway).
      const w = new BrowserWindow({ show: false, webPreferences: secure });
      await w.loadFile(file);
      const out = await w.webContents.executeJavaScript("window.room.state()");
      w.destroy();
      return out;
    },
    { secure: secureWebPreferences(preload), file },
  );
  assert.equal(got, null);
  const own = await roomPage()!.evaluate(() => (window as unknown as { room: { state(): Promise<{ doc: { class: { title: string } } } | null> } }).room.state());
  assert.equal(own?.doc.class.title, TITLE);
  assert.deepEqual(Object.keys(own ?? {}).sort(), ["doc", "link", "view"], "a frame, not the presenter's snapshot");
});

test("the room window is on the display the rule picks, and the presenter keeps its window", async () => {
  const facts = await app.evaluate(({ BrowserWindow, screen }) => {
    const all = BrowserWindow.getAllWindows();
    const room = all.find((x) => x.webContents.getURL().endsWith("/dist/room.html"))!;
    const main = all.find((x) => x !== room)!;
    return {
      displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea })),
      presenter: main.getBounds(),
      presenterDisplay: screen.getDisplayMatching(main.getBounds()).id,
      roomDisplay: screen.getDisplayMatching(room.getBounds()).id,
      mainUrl: main.webContents.getURL(),
    };
  });
  const want = placeRoom(facts.displays as DisplayFacts[], facts.presenterDisplay, facts.presenter as Rect, null);
  assert.ok(want);
  assert.equal(facts.roomDisplay, want.displayId);
  assert.match(facts.mainUrl, /\/dist\/presenter\.html$/);
  await waitFor(() => app.evaluate(({ BrowserWindow }, full) => BrowserWindow.getAllWindows().some((x) => x.webContents.getURL().endsWith("/dist/room.html") && x.isFullScreen() === full), want.fullScreen), 5000, "full screen as placed");
});

test("the room screen follows the clock; the class list while the class is pinned keeps it, Back to the class keeps one", async () => {
  const room = roomPage()!;
  await command({ type: "start" });
  await room.waitForFunction(() => document.querySelector(".intro") === null);
  await shot(room, "running");
  await menu("class-list");
  await onPage("classlist.html");
  await page.waitForSelector('footer [data-action="back"]');
  await sleep(300);
  assert.equal(await windowCount(), 2, "the class can be gone back to");
  await page.locator('footer [data-action="back"]').click();
  await onPage("presenter.html");
  await sleep(300);
  assert.equal(await windowCount(), 2, "one room window, not two");
});

test("the class ends: the room stays on Class Complete; on the class list it closes", async () => {
  const room = roomPage()!;
  for (let i = 0; i < 400; i++) {
    const s = await command({ type: "jump", deltaMs: 5000 });
    if (s?.view?.status === "ended") break;
  }
  await room.waitForFunction(() => document.querySelector(".gel")?.textContent?.includes("Complete") === true);
  assert.equal(await windowCount(), 2, "the riders see the end");
  await shot(room, "finished");
  await menu("class-list");
  await onPage("classlist.html");
  await waitFor(async () => (await windowCount()) === 1, 5000, "the room window to close");
});

test("a class file opened from the list opens the room window too, and leaving that class closes it", async () => {
  const [first] = converterExamples();
  const title = (JSON.parse(readFileSync(first, "utf8")) as { class: { title: string } }).class.title;
  await app.evaluate(({ dialog, Menu }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
    Menu.getApplicationMenu()?.getMenuItemById("open-class")?.click();
  }, first);
  await onPage("presenter.html");
  const room = await theRoom();
  await room.waitForFunction((t) => document.querySelector(".intro h1")?.textContent === t, title);
  await menu("class-list");
  await onPage("classlist.html");
  await waitFor(async () => (await windowCount()) === 1, 5000, "the room window to close");
});

test("closing the presenter closes the room window, and the application quits", async () => {
  await page.waitForSelector('footer [data-action="start"]');
  await page.locator('footer [data-action="start"]').click();
  await theRoom();
  const gone = new Promise<void>((r) => app.once("close", () => r()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().endsWith("/dist/room.html"))?.close());
  await gone;
  assert.equal(closed, true);
});
