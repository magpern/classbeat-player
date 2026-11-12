// The desktop shell's entry point: one instance, one hardened presenter window, the File menu
// and the IPC. The shell owns the class clock (ADR 0001); the presenter only shows it.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow } from "electron";
import { createController } from "./controller.ts";
import { enableSandboxUnlessTest, hardenSession } from "./hardening.ts";
import { registerIpc } from "./ipc.ts";
import { installMenu } from "./menu.ts";
import { pickClassFile } from "./open-file.ts";
import { setupPairing } from "./pairing/setup.ts";
import type { PairingService } from "./pairing/service.ts";
import { selectMusic } from "./select-music.ts";
import { secureWebPreferences } from "./web-preferences.ts";

const DIST = __dirname;
const APP_DIR_URL = `${pathToFileURL(DIST).href}/`;
const PRESENTER_FILE = join(DIST, "presenter.html");
const PRESENTER_URL = pathToFileURL(PRESENTER_FILE).href;

let presenter: BrowserWindow | null = null;
let pairing: PairingService | null = null;
// The follower is chosen by platform; it asks the system nothing until the instructor picks Follow.
const music = selectMusic(process.platform);
const controller = createController(undefined, music.reader, music.transport);

const live = (): BrowserWindow | null => (presenter && !presenter.isDestroyed() ? presenter : null);

async function openClass(): Promise<void> {
  const win = live();
  if (!win) return;
  const picked = await pickClassFile(win);
  if (picked === null) return;
  if ("error" in picked) controller.refuse(picked.error);
  else controller.open(picked.name, picked.text);
}

function createPresenter(): void {
  presenter = new BrowserWindow({
    width: 1000,
    height: 760,
    title: "Class player",
    show: true,
    webPreferences: secureWebPreferences(join(DIST, "preload.cjs")),
  });
  presenter.on("closed", () => {
    presenter = null;
  });
  void presenter.loadFile(PRESENTER_FILE);
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
    registerIpc(controller, () => ({ presenterId: live()?.webContents.id ?? null, presenterUrl: PRESENTER_URL }), pairing);
    installMenu(() => void openClass());
    createPresenter();
    controller.attach(() => live()?.webContents ?? null);
  });
  // Quitting from the menu skips window-all-closed; a follower's helper must stop either way.
  app.on("will-quit", () => controller.stop());
  app.on("will-quit", () => pairing?.stop());
  app.on("window-all-closed", () => {
    controller.stop();
    app.quit();
  });
}
