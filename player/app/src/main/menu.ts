// The application menu: File > Open a class, Quit. No developer tools, no reload.
import { app, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";

export function installMenu(openClass: () => void): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: "quit" as const }] }] : []),
    {
      label: "File",
      submenu: [
        { id: "open-class", label: "Open Class…", accelerator: "CmdOrCtrl+O", click: openClass },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { label: "Edit", submenu: [{ role: "copy" }, { role: "selectAll" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
