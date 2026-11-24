// One cached mix as the cache sees it: its header read and authenticated with the account's cache
// key, its keys, and the two ways an entry ends (ADR 0013 section 3). A header that does not parse
// or verify is no entry at all. Nothing here logs.
import { fileKey, headerKey } from "../../core/mix/cache-crypto.ts";
import { checkHeader, encodeHeader, parseHeader } from "../../core/mix/cache-header.ts";
import type { MixHeader } from "../../core/mix/cache-header.ts";
import type { AccountFolder } from "./cache-files.ts";

/** One account's open cache: its folder and its cache key, which never leaves the main process. */
export interface AccountCache {
  readonly folder: AccountFolder;
  readonly cacheKey: Buffer;
}

export interface EntryKeys {
  readonly fileId: Buffer;
  readonly tag: Buffer;
  /** Seals and opens the chunks. */
  readonly chunkKey: Buffer;
  /** Authenticates the header. */
  readonly macKey: Buffer;
}

export function keysOf(cacheKey: Buffer, fileIdHex: string, tagHex: string): EntryKeys {
  const fileId = Buffer.from(fileIdHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  return { fileId, tag, chunkKey: fileKey(cacheKey, fileId, tag), macKey: headerKey(cacheKey, fileId, tag) };
}

/** The entry's header if it is there, parses and verifies under this account's key and names `tag`; else null. */
export function loadHeader(c: AccountCache, tag: string): MixHeader | null {
  const bytes = c.folder.readHeader(tag);
  if (bytes === null) return null;
  const parsed = parseHeader(bytes);
  if (parsed === null) return null;
  return checkHeader(parsed, keysOf(c.cacheKey, parsed.header.fileId, tag).macKey, tag);
}

export function saveHeader(c: AccountCache, h: MixHeader): void {
  c.folder.writeHeader(h.tag, encodeHeader(h, keysOf(c.cacheKey, h.fileId, h.tag).macKey));
}

/** Marks the entry `bad` first, so nothing plays it if the deletion fails, then deletes it. */
export function dropBad(c: AccountCache, h: MixHeader): void {
  try {
    saveHeader(c, { ...h, state: "bad" });
  } catch {
    // the deletion below is what matters
  }
  c.folder.remove(h.tag);
}
