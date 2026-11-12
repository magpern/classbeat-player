// The desktop shell's entry point: one instance, one hardened presenter window, the File menu
// and the IPC. The shell owns the class clock (ADR 0001); the presenter only shows it.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow } from "electron";
import { createController } from "./controller.ts";
import { hardenSession } from "./hardening.ts";
import { registerIpc } from "./ipc.ts";
import { installMenu } from "./menu.ts";
import { pickClassFile } from "./open-file.ts";
import { secureWebPreferences } from "./web-preferences.ts";

const DIST = __dirname;
const APP_DIR_URL = `${pathToFileURL(DIST).href}/`;
const PRESENTER_FILE = join(DIST, "presenter.html");
const PRESENTER_URL = pathToFileURL(PRESENTER_FILE).href;

let presenter: BrowserWindow | null = null;
const controller = createController();

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
    registerIpc(controller, () => ({ presenterId: live()?.webContents.id ?? null, presenterUrl: PRESENTER_URL }));
    installMenu(() => void openClass());
    createPresenter();
    controller.attach(() => live()?.webContents ?? null);
  });
  app.on("window-all-closed", () => {
    controller.stop();
    app.quit();
  });
}
