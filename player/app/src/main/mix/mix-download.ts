// Downloading one mix into an account's encrypted cache (ADR 0013 section 3). The bytes come from
// the source straight to this process, are cut into 256 KiB chunks and sealed in memory; only
// sealed chunks reach the disk. A download resumes only when the source states the same length and
// the same SHA-256 and version as the header recorded; otherwise it starts over with a new file id,
// so a new key. A torn last record is kept until the chunk that replaces it is sealed, and is
// overwritten only if the new sealed bytes begin with exactly the torn ones (the same plaintext at
// the same index); if not, the file is dropped and the download starts over under a new key. So
// no chunk index is ever sealed with two different plaintexts under one key.
import { createHash, randomBytes } from "node:crypto";
import type { Hash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { FILE_ID_BYTES, mixTag, openChunk, sealChunk } from "../../core/mix/cache-crypto.ts";
import { identityOf, sameSource } from "../../core/mix/cache-header.ts";
import type { MixHeader, SourceIdentity } from "../../core/mix/cache-header.ts";
import { chunkCount, plainEnd, plainLength, sealedEnd, sealedStart, wholeChunks } from "../../core/mix/cache-layout.ts";
import type { MixSource } from "../../core/mix/source.ts";
import { dropBad, keysOf, loadHeader, saveHeader } from "./cache-entry.ts";
import type { AccountCache, EntryKeys } from "./cache-entry.ts";

export type DownloadOutcome = "complete" | "interrupted" | "token_invalid" | "unavailable" | "not_found" | "not_allowed" | "too_large" | "bad";

export interface DownloadInput {
  readonly source: MixSource;
  readonly token: string;
  readonly mixId: string;
  readonly now: number;
  readonly capBytes: number;
  /** A stream that sends nothing for this long is dropped; the download resumes later. */
  readonly idleMs?: number;
}

export const DOWNLOAD_IDLE_MS = 60_000;

/** Where writing goes on: the open data file, the next chunk index, the hash so far and a torn record. */
interface Progress {
  readonly header: MixHeader;
  readonly keys: EntryKeys;
  readonly file: FileHandle;
  next: number;
  readonly hash: Hash;
  torn: Buffer;
}

const placeOf = (h: MixHeader, k: EntryKeys, i: number) => ({ key: k.chunkKey, fileId: k.fileId, tag: k.tag, index: i, final: i === chunkCount(h.byteLength) - 1 });

async function readAt(file: FileHandle, at: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let n = 0;
  while (n < length) {
    const { bytesRead } = await file.read(buf, n, length - n, at + n);
    if (bytesRead === 0) break;
    n += bytesRead;
  }
  return buf.subarray(0, n);
}

/** Picks up a download: every whole chunk on disk is authenticated again (and hashed); bytes after them are the torn record. */
async function resume(c: AccountCache, h: MixHeader): Promise<Progress | null> {
  const keys = keysOf(c.cacheKey, h.fileId, h.tag);
  let file: FileHandle;
  try {
    file = await c.folder.openData(h.tag, true);
  } catch {
    return null;
  }
  try {
    const st = await file.stat();
    if (!st.isFile()) throw new Error("not a file");
    const count = chunkCount(h.byteLength);
    const n = wholeChunks(h.byteLength, st.size);
    const hash = createHash("sha256");
    for (let i = 0; i < n; i++) {
      const plain = openChunk(placeOf(h, keys, i), await readAt(file, sealedStart(i), sealedEnd(h.byteLength, i + 1) - sealedStart(i)));
      if (plain === null) throw new Error("bad chunk");
      hash.update(plain);
    }
    let torn: Buffer = Buffer.alloc(0);
    if (n < count) torn = await readAt(file, sealedStart(n), st.size - sealedStart(n));
    else if (st.size > sealedEnd(h.byteLength, count)) await file.truncate(sealedEnd(h.byteLength, count));
    return { header: h, keys, file, next: n, hash, torn };
  } catch {
    await file.close();
    return null;
  }
}

async function fresh(c: AccountCache, tag: string, id: SourceIdentity, now: number): Promise<Progress> {
  c.folder.remove(tag);
  const header: MixHeader = { fileId: randomBytes(FILE_ID_BYTES).toString("hex"), tag, ...id, state: "downloading", usedAt: now };
  saveHeader(c, header);
  const file = await c.folder.createData(tag);
  return { header, keys: keysOf(c.cacheKey, header.fileId, tag), file, next: 0, hash: createHash("sha256"), torn: Buffer.alloc(0) };
}

/** Seals chunk `p.next` and writes it; false when a torn record there held other bytes. */
async function writeChunk(p: Progress, plain: Buffer): Promise<boolean> {
  const sealed = sealChunk(placeOf(p.header, p.keys, p.next), plain);
  if (p.torn.length > 0) {
    if (p.torn.length > sealed.length || !sealed.subarray(0, p.torn.length).equals(p.torn)) return false;
    p.torn = Buffer.alloc(0);
  }
  await p.file.write(sealed, 0, sealed.length, sealedStart(p.next));
  p.hash.update(plain);
  p.next++;
  return true;
}

type Fill = "done" | "short" | "restart" | "bad" | "token_invalid" | "unavailable" | "not_found";

/** The next piece of the stream, or "idle" when none came for `idleMs`. */
async function nextPiece(it: AsyncIterator<Uint8Array>, idleMs: number): Promise<IteratorResult<Uint8Array> | "idle"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<"idle">((resolve) => (timer = setTimeout(() => resolve("idle"), idleMs)));
  try {
    return await Promise.race([it.next(), idle]);
  } finally {
    clearTimeout(timer);
  }
}

/** Reads from the source and writes sealed chunks until the mix is whole or the stream stops. */
async function fill(p: Progress, d: DownloadInput): Promise<Fill> {
  const count = chunkCount(p.header.byteLength);
  if (p.next === count) return "done";
  const r = await Promise.resolve()
    .then(() => d.source.read(d.token, d.mixId, plainEnd(p.header.byteLength, p.next)))
    .catch(() => ({ ok: false, refusal: "unavailable" }) as const);
  if (!r.ok) return r.refusal;
  let parts: Buffer[] = [];
  let have = 0;
  let it: AsyncIterator<Uint8Array> | undefined;
  let ended = false;
  try {
    it = r.bytes[Symbol.asyncIterator]();
    for (;;) {
      const step = await nextPiece(it, d.idleMs ?? DOWNLOAD_IDLE_MS);
      if (step === "idle") return "short";
      if (step.done === true) {
        ended = true;
        break;
      }
      const piece = step.value;
      if (!(piece instanceof Uint8Array)) return "bad";
      parts.push(Buffer.from(piece));
      have += piece.length;
      while (p.next < count && have >= plainLength(p.header.byteLength, p.next)) {
        const all = Buffer.concat(parts);
        const need = plainLength(p.header.byteLength, p.next);
        if (!(await writeChunk(p, all.subarray(0, need)))) return "restart";
        parts = [all.subarray(need)];
        have -= need;
      }
      // More bytes than the source stated: the file is not the one described.
      if (p.next === count && have > 0) return "bad";
    }
  } catch {
    return "short";
  } finally {
    // A stream left early is told to stop; never awaited, so a stalled one cannot hold the download.
    if (!ended) void Promise.resolve().then(() => it?.return?.()).catch(() => undefined);
  }
  return p.next === count ? "done" : "short";
}

const refusalOf = (f: Fill): DownloadOutcome => (f === "short" ? "interrupted" : f === "done" || f === "restart" ? "bad" : f);

export async function downloadMix(c: AccountCache, d: DownloadInput): Promise<DownloadOutcome> {
  const tag = mixTag(c.cacheKey, d.mixId).toString("hex");
  const desc = await Promise.resolve()
    .then(() => d.source.describe(d.token, d.mixId))
    .catch(() => ({ ok: false, refusal: "unavailable" }) as const);
  if (!desc.ok) return desc.refusal;
  c.folder.ensure();
  if (desc.mix.mayPlay !== true) {
    c.folder.remove(tag);
    return "not_allowed";
  }
  if (Number.isSafeInteger(desc.mix.byteLength) && desc.mix.byteLength > d.capBytes) return "too_large";
  const id = identityOf(desc.mix, d.capBytes);
  if (id === null) return "unavailable";
  const kept = loadHeader(c, tag);
  if (kept?.state === "complete" && sameSource(kept, id)) return "complete";
  // Two tries at most: a resume that meets a torn record with other bytes starts over once, under a new key.
  for (let attempt = 0; attempt < 2; attempt++) {
    const old = loadHeader(c, tag);
    const p = (old?.state === "downloading" && sameSource(old, id) ? await resume(c, old) : null) ?? (await fresh(c, tag, id, d.now));
    let f: Fill;
    try {
      f = await fill(p, d);
    } finally {
      await p.file.close();
    }
    if (f === "restart") {
      c.folder.remove(tag);
      continue;
    }
    if (f !== "done") {
      if (f === "bad") dropBad(c, p.header);
      return refusalOf(f);
    }
    if (p.header.sha256 !== null && p.hash.digest("hex") !== p.header.sha256) {
      dropBad(c, p.header);
      return "bad";
    }
    // A play while downloading may have moved its last use on; that is kept.
    const now = loadHeader(c, tag);
    saveHeader(c, { ...p.header, state: "complete", usedAt: now?.fileId === p.header.fileId ? now.usedAt : p.header.usedAt });
    return "complete";
  }
  return "bad";
}
