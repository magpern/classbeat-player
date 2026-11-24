// The files of one account's mix folder, `<app data>/mixes/<account key>/` (ADR 0013 section 3):
// per mix `<tag>.hdr` (the header) and `<tag>.mix` (the sealed chunks). Folders are this user's
// only, files are created exclusively and opened without following a link, and no path is ever
// built from anything but a 64-hex account key and a 64-hex mix tag. Only sealed bytes and headers
// pass through here; nothing is logged.
import { chmodSync, constants, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { readCapped } from "../capped-read.ts";
import { MAX_HEADER_BYTES } from "../../core/mix/cache-header.ts";

const HEX64 = /^[0-9a-f]{64}$/;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const ENTRY = /^([0-9a-f]{64})\.(hdr|mix)$/;

const hex = (s: string, what: string): string => {
  if (!HEX64.test(s)) throw new Error(`not a ${what}`);
  return s;
};

function privateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const st = lstatSync(path);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("not a folder");
  if (process.platform !== "win32") chmodSync(path, 0o700);
}

export interface AccountFolder {
  readonly dir: string;
  /** Creates the folder (and `mixes/`) if missing, this user's only. */
  ensure(): void;
  /** The header's bytes, or null when there is none or it is not a plain, small file. */
  readHeader(tag: string): Buffer | null;
  /** Replaces the header in one step. */
  writeHeader(tag: string, bytes: Uint8Array): void;
  /** Creates the data file, failing if anything is already there. */
  createData(tag: string): Promise<FileHandle>;
  /** Opens the existing data file for reading and writing, or for reading only. */
  openData(tag: string, write: boolean): Promise<FileHandle>;
  /** Deletes the header, then the data file. */
  remove(tag: string): void;
  /** The tags with a header or data file, every other name in the folder, and each tag's bytes on disk. */
  scan(): { readonly tags: Map<string, number>; readonly strays: string[] };
}

export function accountFolder(root: string, account: string): AccountFolder {
  const mixes = join(root, "mixes");
  const dir = join(mixes, hex(account, "account key"));
  const hdr = (t: string): string => join(dir, `${hex(t, "mix tag")}.hdr`);
  const data = (t: string): string => join(dir, `${hex(t, "mix tag")}.mix`);
  return {
    dir,
    ensure() {
      privateDir(mixes);
      privateDir(dir);
    },
    readHeader(tag) {
      try {
        return readCapped(hdr(tag), MAX_HEADER_BYTES);
      } catch {
        return null;
      }
    },
    writeHeader(tag, bytes) {
      const file = hdr(tag);
      const tmp = `${file}.tmp`;
      rmSync(tmp, { force: true });
      try {
        writeFileSync(tmp, bytes, { mode: 0o600, flag: "wx" });
        renameSync(tmp, file);
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
    },
    createData: (tag) => open(data(tag), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600),
    openData: (tag, write) => open(data(tag), (write ? constants.O_RDWR : constants.O_RDONLY) | NOFOLLOW),
    remove(tag) {
      rmSync(hdr(tag), { force: true });
      rmSync(`${hdr(tag)}.tmp`, { force: true });
      rmSync(data(tag), { force: true });
    },
    scan() {
      const tags = new Map<string, number>();
      const strays: string[] = [];
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return { tags, strays };
      }
      for (const n of names) {
        const m = n.match(ENTRY);
        if (m === null) {
          strays.push(n);
          continue;
        }
        let size = 0;
        try {
          const st = lstatSync(join(dir, n));
          size = st.isFile() ? st.size : 0;
        } catch {
          // gone meanwhile
        }
        tags.set(m[1]!, (tags.get(m[1]!) ?? 0) + size);
      }
      return { tags, strays };
    },
  };
}

/** Removes one stray name from the folder (a leftover temporary file, or anything planted there); a link itself, never its target. */
export function removeStray(folder: AccountFolder, name: string): void {
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") return;
  rmSync(join(folder.dir, name), { recursive: true, force: true });
}
