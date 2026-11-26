// Builds local music file finding from Electron, the pairing and class sync (ADR 0017 section 2).
// The folder is chosen in the operating system's own dialog, in this process: a path never comes
// from a page. The index is kept in the app's own folder, one file per account, and is wiped with
// the class cache: when the pairing is forgotten, and at startup when a cache is left with no
// pairing behind it (main/sync/link.ts).
import { join } from "node:path";
import { app, dialog } from "electron";
import type { BrowserWindow } from "electron";
import type { PairingService } from "../pairing/service.ts";
import { indexStore, INDEX_DIR } from "./index-store.ts";
import { createMusicFiles } from "./service.ts";
import type { MusicFiles } from "./service.ts";

export interface MusicFilesSetup {
  /** The paired account's opaque key (main/sync/link.ts `credentialOf`), or null. */
  account(): string | null;
  /** The class list's document of a class (main/sync/service.ts `document`). */
  classDocument(id: string): unknown;
  /** The window the folder dialog belongs to. */
  window(): BrowserWindow | null;
}

async function pickFolder(win: BrowserWindow | null): Promise<string | null> {
  if (win === null) return null;
  const r = await dialog.showOpenDialog(win, { title: "Choose the folder with your music", properties: ["openDirectory"] });
  return r.canceled || r.filePaths.length !== 1 ? null : r.filePaths[0];
}

export function setupMusicFiles(paired: PairingService, s: MusicFilesSetup): MusicFiles {
  const music = createMusicFiles({
    account: s.account,
    classDocument: s.classDocument,
    pickFolder: () => pickFolder(s.window()),
    store: indexStore(join(app.getPath("userData"), INDEX_DIR)),
  });
  paired.watch((change) => {
    if (change === "forgotten") music.forgotten();
  });
  // Not when the keychain cannot be read at all, where the pairing may still be there.
  if (paired.credential() === null && paired.keychainAvailable()) music.forgotten();
  return music;
}
