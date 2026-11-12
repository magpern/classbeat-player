// File > Open: the operating system's file dialog, then the file's text. The only place the shell
// reads a class from disk; the path always comes from the dialog the user answered, never from a
// renderer.
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { dialog } from "electron";
import type { BrowserWindow } from "electron";
import { MAX_CLASS_FILE_BYTES, TOO_LARGE_MESSAGE } from "../core/class-file.ts";

export type Picked = { readonly name: string; readonly text: string } | { readonly name: string; readonly error: string } | null;

export async function readPicked(path: string): Promise<Picked> {
  const name = basename(path);
  try {
    const info = await stat(path);
    if (!info.isFile()) return { name, error: "This is not a file." };
    if (info.size > MAX_CLASS_FILE_BYTES) return { name, error: TOO_LARGE_MESSAGE };
    return { name, text: await readFile(path, "utf8") };
  } catch {
    return { name, error: "This file could not be read." };
  }
}

export async function pickClassFile(win: BrowserWindow): Promise<Picked> {
  const r = await dialog.showOpenDialog(win, {
    title: "Open a class",
    properties: ["openFile"],
    filters: [
      { name: "Class files", extensions: ["json"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (r.canceled || r.filePaths.length !== 1) return null;
  return readPicked(r.filePaths[0]);
}
