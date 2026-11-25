// The update settings' file in the app's own folder (ADR 0014, sections 1 and 5). Only the main
// process reads or writes it; the renderer reaches the two switches through their boolean setters
// and never the feed address. Read without trusting it (capped, no link followed), written whole
// through a temporary file created exclusively, readable by this user only.
import { chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSettings, writeSettings } from "../../core/update/settings.ts";
import { readCapped } from "../capped-read.ts";
import type { SettingsStore } from "./service.ts";

export const SETTINGS_FILE = "update-settings.json";
/** Far more than the three settings need; a larger file is not read (the defaults hold). */
export const MAX_SETTINGS_BYTES = 16 * 1024;

export function settingsFile(dir: string): SettingsStore {
  const file = join(dir, SETTINGS_FILE);
  return {
    load() {
      let data: Buffer | null = null;
      try {
        data = readCapped(file, MAX_SETTINGS_BYTES);
      } catch {
        // No file yet, or one that cannot be opened: the defaults.
      }
      return readSettings(data === null ? null : data.toString("utf8"));
    },
    save(s) {
      const tmp = `${file}.tmp`;
      // A stale temporary file, or a link planted in its place, goes first (the link, never its target).
      rmSync(tmp, { force: true });
      try {
        writeFileSync(tmp, writeSettings(s), { mode: 0o600, flag: "wx" });
        chmodSync(tmp, 0o600);
        renameSync(tmp, file);
      } catch {
        rmSync(tmp, { force: true });
        throw new Error("settings not saved");
      }
    },
  };
}
