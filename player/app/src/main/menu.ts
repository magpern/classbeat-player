// The application menu: File > Open a class file, Class list, Show the room screen, Quit. No
// developer tools, no reload (no reload role: Ctrl+Shift+R is the R of "Room" here).
import { app, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";

export interface MenuActions {
  readonly openClass: () => void;
  readonly showList: () => void;
  /** Opens the room screen's window again after it was closed by hand (main.ts, `roomMayOpen`). */
  readonly showRoom: () => void;
}

export function installMenu(a: MenuActions): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: "quit" as const }] }] : []),
    {
      label: "File",
      submenu: [
        { id: "open-class", label: "Open a class file…", accelerator: "CmdOrCtrl+O", click: a.openClass },
        { id: "class-list", label: "Class list", accelerator: "CmdOrCtrl+L", click: a.showList },
        { id: "show-room", label: "Show the room screen", accelerator: "CmdOrCtrl+Shift+R", enabled: false, click: a.showRoom },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { label: "Edit", submenu: [{ role: "copy" }, { role: "selectAll" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Enables or disables File > Show the room screen (main.ts keeps it equal to `roomMayOpen`). */
export function setRoomItemEnabled(enabled: boolean): void {
  const item = Menu.getApplicationMenu()?.getMenuItemById("show-room");
  if (item && item.enabled !== enabled) item.enabled = enabled;
}
