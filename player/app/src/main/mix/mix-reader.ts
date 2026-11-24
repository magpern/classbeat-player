// Reading a cached mix back, one authenticated chunk at a time, in memory (ADR 0013 section 3). A
// chunk that fails authentication, a missing chunk or a complete file of the wrong size marks the
// mix bad and deletes it; a chunk not yet written while the download goes on is "pending". The
// plaintext is returned to the caller in the main process only and is never written anywhere.
import { mixTag, openChunk } from "../../core/mix/cache-crypto.ts";
import { chunkCount, plainLength, sealedEnd, sealedStart } from "../../core/mix/cache-layout.ts";
import type { MixHeader } from "../../core/mix/cache-header.ts";
import { dropBad, keysOf, loadHeader } from "./cache-entry.ts";
import type { AccountCache } from "./cache-entry.ts";

/** `gone`: the entry was replaced or deleted meanwhile (a new download, sign-out, eviction). */
export type ChunkRead = { readonly ok: true; readonly plain: Buffer } | { readonly ok: false; readonly reason: "pending" | "bad" | "gone" };

export interface MixReader {
  readonly byteLength: number;
  readonly chunks: number;
  /** Whether the whole file was downloaded and checked when the reader was opened. */
  readonly complete: boolean;
  /** Plaintext length of chunk `i`. */
  chunkLength(i: number): number;
  readChunk(i: number): Promise<ChunkRead>;
}

/** A reader for the mix, or null when it is not cached (or its header does not verify, or it is bad). */
export function openReader(c: AccountCache, mixId: string): MixReader | null {
  const tag = mixTag(c.cacheKey, mixId).toString("hex");
  const h = loadHeader(c, tag);
  if (h === null || h.state === "bad") return null;
  const keys = keysOf(c.cacheKey, h.fileId, tag);
  const count = chunkCount(h.byteLength);
  const sameEntry = (): MixHeader | null => {
    const now = loadHeader(c, tag);
    return now !== null && now.fileId === h.fileId ? now : null;
  };
  const bad = (): ChunkRead => {
    const now = sameEntry();
    if (now === null) return { ok: false, reason: "gone" };
    dropBad(c, now);
    return { ok: false, reason: "bad" };
  };
  return {
    byteLength: h.byteLength,
    chunks: count,
    complete: h.state === "complete",
    chunkLength: (i) => plainLength(h.byteLength, i),
    async readChunk(i) {
      if (!Number.isSafeInteger(i) || i < 0 || i >= count) throw new RangeError("no such chunk");
      let file;
      try {
        file = await c.folder.openData(tag, false);
      } catch {
        return sameEntry() === null ? { ok: false, reason: "gone" } : bad();
      }
      try {
        const st = await file.stat();
        const now = sameEntry();
        if (now === null) return { ok: false, reason: "gone" };
        const whole = sealedEnd(h.byteLength, count);
        if (!st.isFile() || (now.state === "complete" && st.size !== whole) || st.size > whole) return bad();
        const end = sealedEnd(h.byteLength, i + 1);
        if (st.size < end) return now.state === "downloading" ? { ok: false, reason: "pending" } : bad();
        const sealed = Buffer.alloc(end - sealedStart(i));
        const { bytesRead } = await file.read(sealed, 0, sealed.length, sealedStart(i));
        const plain = bytesRead === sealed.length ? openChunk({ key: keys.chunkKey, fileId: keys.fileId, tag: keys.tag, index: i, final: i === count - 1 }, sealed) : null;
        return plain === null ? bad() : { ok: true, plain };
      } finally {
        await file.close();
      }
    },
  };
}
