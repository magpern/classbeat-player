// The desktop shell's entry point: one instance, one hardened presenter window, the room screen's
// window while a class is open, the File menu and the IPC. The shell owns the class clock (ADR 0001); the presenter only shows it.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import type { Trusted } from "../core/ipc-policy.ts";
import { createController } from "./controller.ts";
import { enableSandboxUnlessTest, hardenSession } from "./hardening.ts";
import { registerIpc } from "./ipc.ts";
import { createListController } from "./list/list-controller.ts";
import type { ListController } from "./list/list-controller.ts";
import { registerListHandlers } from "./list/list-handlers.ts";
import { openClassFile } from "./list/open-class-file.ts";
import { installMenu, setRoomItemEnabled } from "./menu.ts";
import { pickClassFile } from "./open-file.ts";
import { electronBlocker } from "./electron-blocker.ts";
import { createKeepAwake } from "./keep-awake.ts";
import { roomCloses, roomMayOpen } from "../core/room/lifecycle.ts";
import { registerRoomHandlers } from "./room/room-handlers.ts";
import { createRoomWindow } from "./room/room-window.ts";
import { registerLiveHandlers } from "./live/live-handlers.ts";
import type { LiveService } from "./live/live-service.ts";
import { setupLive } from "./live/setup.ts";
import { setupPairing } from "./pairing/setup.ts";
import type { PairingService } from "./pairing/service.ts";
import { selectMusic } from "./select-music.ts";
import { credentialOf } from "./sync/link.ts";
import { setupSync } from "./sync/setup.ts";
import type { SyncService } from "./sync/service.ts";
import { secureWebPreferences } from "./web-preferences.ts";
import { PRESENTER_SIZE } from "./window-size.ts";

const DIST = __dirname;
const APP_DIR_URL = `${pathToFileURL(DIST).href}/`;
const PRESENTER_FILE = join(DIST, "presenter.html");
const PRESENTER_URL = pathToFileURL(PRESENTER_FILE).href;
const LIST_FILE = join(DIST, "classlist.html");
const LIST_URL = pathToFileURL(LIST_FILE).href;
const ROOM_FILE = join(DIST, "room.html");
const PRESENTER_PRELOAD = join(DIST, "preload.cjs");
const ROOM_PRELOAD = join(DIST, "room-preload.cjs");

// The one window: it shows the class list first, and the presenter once a class is started.
let presenter: BrowserWindow | null = null;
let list: ListController | null = null;
let pairing: PairingService | null = null;
let sync: SyncService | null = null;
// The phone remote: off until the instructor starts it in the presenter, and only for the open class run.
let phoneRemote: LiveService | null = null;
// The follower is chosen by platform; it asks the system nothing until the instructor picks Follow.
const music = selectMusic(process.platform);
const keepAwake = createKeepAwake(electronBlocker);
const controller = createController(undefined, music.reader, music.transport);

const live = (): BrowserWindow | null => (presenter && !presenter.isDestroyed() ? presenter : null);
// The room screen's own window: it opens with every class that opens, and closes with the class.
const room = createRoomWindow({ file: ROOM_FILE, url: pathToFileURL(ROOM_FILE).href, preload: ROOM_PRELOAD, presenter: live });
const pinned = (): boolean => (sync?.view().pinned ?? null) !== null;
// Whether the main window is on the class list, as the shell asked for it: set when the shell starts
// a page load, so a command right after "Class list" already sees the list (the URL changes only
// when the load commits). A navigation the shell did not ask for updates it when it commits.
let onList = true;
let requested: string | null = null;
const onListPage = (): boolean => onList;
const pageUrl = (url: string): string => url.split(/[?#]/, 1)[0] ?? "";
// File > Show the room screen is enabled exactly when it would open the room window.
const refreshRoomItem = (): void => setRoomItemEnabled(roomMayOpen(controller.snapshot().doc !== null, onList, pinned()));

function showPage(file: string): void {
  const win = live();
  if (!win) return;
  requested = pathToFileURL(file).href;
  onList = requested === LIST_URL;
  refreshRoomItem();
  void win.loadFile(file);
}
function committed(url: string): void {
  if (requested !== null && pageUrl(url) !== requested) return;
  requested = null;
  onList = pageUrl(url) === LIST_URL;
  refreshRoomItem();
}
function showPresenter(): void {
  showPage(PRESENTER_FILE);
  // "Back to the class" after the room window was closed by hand opens it again.
  if (controller.snapshot().doc !== null) room.open();
}
// File > Show the room screen: opens a room window closed by hand again, while the class is open.
function showRoom(): void {
  if (roomMayOpen(controller.snapshot().doc !== null, onListPage(), pinned())) room.open();
}
function showList(): void {
  showPage(LIST_FILE);
  if (roomCloses(true, pinned())) room.close();
}

async function openClass(): Promise<void> {
  const win = live();
  if (!win || list === null) return;
  const l = list;
  await openClassFile({
    pick: () => pickClassFile(win),
    open: (name, text) => controller.open(name, text),
    refuse: (message) => controller.refuse(message),
    fileFailed: (e) => l.fileFailed(e),
    dismiss: () => l.dismissFileError(),
    release: () => l.release(),
    showPresenter,
    onList: onListPage,
  });
}

function createPresenter(): void {
  presenter = new BrowserWindow({
    ...PRESENTER_SIZE,
    title: "Class player",
    show: true,
    webPreferences: secureWebPreferences(PRESENTER_PRELOAD),
  });
  // On Windows the constructor's minimum is applied to the outer window, so the content area could
  // shrink by the frame; setMinimumSize takes the outer size, so add the frame to the content minimum.
  const [outerW, outerH] = presenter.getSize();
  const [contentW, contentH] = presenter.getContentSize();
  presenter.setMinimumSize(PRESENTER_SIZE.minWidth + (outerW! - contentW!), PRESENTER_SIZE.minHeight + (outerH! - contentH!));
  presenter.webContents.on("did-navigate", (_e, url) => committed(url));
  presenter.on("closed", () => {
    presenter = null;
    // The class goes with the presenter, and the application quits once both windows are gone.
    room.close();
    keepAwake.release();
    phoneRemote?.stop();
  });
  void presenter.loadFile(LIST_FILE);
}

// Chromium's sandbox for every renderer, unless the test-only --no-sandbox switch is present
// (CI runs without the sandbox helper). Must run before the app is ready.
enableSandboxUnlessTest();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = live();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  void app.whenReady().then(() => {
    hardenSession(APP_DIR_URL, [PRESENTER_PRELOAD, ROOM_PRELOAD]);
    const paired = setupPairing();
    pairing = paired;
    // Keeps the account's classes offline, and the class list shows them.
    sync = setupSync(paired);
    list = createListController({ sync, pairing: paired, account: () => credentialOf(paired)?.account ?? null, open: (name, text) => controller.open(name, text) });
    const trusted = (): Trusted => ({ presenterId: live()?.webContents.id ?? null, presenterUrl: PRESENTER_URL, listUrl: LIST_URL });
    // The class clock reaching its end ends the pin: other classes can start, and a waiting wipe runs.
    controller.onEnded(() => list?.release());
    // Ending while the instructor is on the list closes the class there; on the presenter the room
    // screen stays on "Class Complete" until the instructor leaves it.
    controller.onEnded(() => {
      if (roomCloses(onListPage(), pinned())) room.close();
      refreshRoomItem();
    });
    controller.onOpened(() => room.open());
    // A new class is a new run: the session of the class before ends (ADR 0005 section 2).
    controller.onOpened(() => phoneRemote?.classChanged());
    controller.watch((s) => room.send(s));
    controller.watch(() => refreshRoomItem());
    controller.watch((s) => keepAwake.update(s.view));
    controller.watch(() => phoneRemote?.tick());
    registerRoomHandlers(ipcMain, () => room.trusted(), controller);
    registerIpc(controller, trusted, paired, () => list?.release());
    registerListHandlers(ipcMain, trusted, list, { showPresenter, openFile: openClass });
    phoneRemote = setupLive(controller, paired);
    registerLiveHandlers(ipcMain, trusted, phoneRemote);
    installMenu({ openClass: () => void openClass(), showList, showRoom });
    createPresenter();
    controller.attach(() => live()?.webContents ?? null);
  });
  // Quitting from the menu skips window-all-closed; a follower's helper must stop either way.
  app.on("will-quit", () => controller.stop());
  app.on("will-quit", () => keepAwake.release());
  app.on("will-quit", () => pairing?.stop());
  app.on("will-quit", () => sync?.stop());
  app.on("will-quit", () => phoneRemote?.stop());
  app.on("window-all-closed", () => {
    controller.stop();
    app.quit();
  });
}
