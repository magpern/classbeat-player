// The desktop shell's entry point: one instance, one hardened presenter window, the File menu
// and the IPC. The shell owns the class clock (ADR 0001); the presenter only shows it.
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
import { installMenu } from "./menu.ts";
import { pickClassFile } from "./open-file.ts";
import { setupPairing } from "./pairing/setup.ts";
import type { PairingService } from "./pairing/service.ts";
import { selectMusic } from "./select-music.ts";
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

// The one window: it shows the class list first, and the presenter once a class is started.
let presenter: BrowserWindow | null = null;
let list: ListController | null = null;
let pairing: PairingService | null = null;
let sync: SyncService | null = null;
// The follower is chosen by platform; it asks the system nothing until the instructor picks Follow.
const music = selectMusic(process.platform);
const controller = createController(undefined, music.reader, music.transport);

const live = (): BrowserWindow | null => (presenter && !presenter.isDestroyed() ? presenter : null);

function showPage(file: string): void {
  const win = live();
  if (!win) return;
  void win.loadFile(file);
}
const showPresenter = (): void => showPage(PRESENTER_FILE);
const showList = (): void => showPage(LIST_FILE);

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
    showPresenter,
    onList: () => (live()?.webContents.getURL().split(/[?#]/, 1)[0] ?? "") === LIST_URL,
  });
}

function createPresenter(): void {
  presenter = new BrowserWindow({
    ...PRESENTER_SIZE,
    title: "Class player",
    show: true,
    webPreferences: secureWebPreferences(join(DIST, "preload.cjs")),
  });
  // On Windows the constructor's minimum is applied to the outer window, so the content area could
  // shrink by the frame; setMinimumSize takes the outer size, so add the frame to the content minimum.
  const [outerW, outerH] = presenter.getSize();
  const [contentW, contentH] = presenter.getContentSize();
  presenter.setMinimumSize(PRESENTER_SIZE.minWidth + (outerW! - contentW!), PRESENTER_SIZE.minHeight + (outerH! - contentH!));
  presenter.on("closed", () => {
    presenter = null;
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
    hardenSession(APP_DIR_URL);
    pairing = setupPairing();
    // Keeps the account's classes offline, and the class list shows them.
    sync = setupSync(pairing);
    list = createListController({ sync, pairing, open: (name, text) => controller.open(name, text) });
    const trusted = (): Trusted => ({ presenterId: live()?.webContents.id ?? null, presenterUrl: PRESENTER_URL, listUrl: LIST_URL });
    registerIpc(controller, trusted, pairing);
    registerListHandlers(ipcMain, trusted, list, { showPresenter, openFile: openClass });
    installMenu(() => void openClass(), showList);
    createPresenter();
    controller.attach(() => live()?.webContents ?? null);
  });
  // Quitting from the menu skips window-all-closed; a follower's helper must stop either way.
  app.on("will-quit", () => controller.stop());
  app.on("will-quit", () => pairing?.stop());
  app.on("will-quit", () => sync?.stop());
  app.on("window-all-closed", () => {
    controller.stop();
    app.quit();
  });
}
