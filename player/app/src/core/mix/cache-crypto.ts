// The mix cache's cryptography (ADR 0013 section 3). Pure computation over buffers: no file, no
// network, no clock. From the account's cache key come the mix tag, which names a mix on disk
// instead of its id, and per file two keys bound to the file's random id and the mix tag: one seals
// the 256 KiB chunks with AES-256-GCM, the other authenticates the header. Nothing here logs.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export const CHUNK_BYTES = 256 * 1024;
export const GCM_TAG_BYTES = 16;
export const FILE_ID_BYTES = 32;
export const CACHE_KEY_BYTES = 32;

const MIX_ID_LABEL = Buffer.from("cbp-mix-id", "utf8");
const FILE_KEY_LABEL = Buffer.from("cbp-mix-v1", "utf8");
const HEADER_KEY_LABEL = Buffer.from("cbp-mix-hdr-v1", "utf8");

const need = (b: Uint8Array, n: number, what: string): void => {
  if (b.length !== n) throw new Error(`${what}: wrong length`);
};

/** `HMAC-SHA256(cache key, "cbp-mix-id" || mix id)`: the mix's name on disk. */
export function mixTag(cacheKey: Uint8Array, mixId: string): Buffer {
  need(cacheKey, CACHE_KEY_BYTES, "cache key");
  return createHmac("sha256", cacheKey).update(MIX_ID_LABEL).update(mixId, "utf8").digest();
}

function derive(cacheKey: Uint8Array, fileId: Uint8Array, label: Buffer, tag: Uint8Array): Buffer {
  need(cacheKey, CACHE_KEY_BYTES, "cache key");
  need(fileId, FILE_ID_BYTES, "file id");
  need(tag, 32, "mix tag");
  return Buffer.from(hkdfSync("sha256", cacheKey, fileId, Buffer.concat([label, tag]), 32));
}

/** `HKDF-SHA256(cache key, salt = file id, info = "cbp-mix-v1" || mix tag)`: seals the chunks. */
export const fileKey = (cacheKey: Uint8Array, fileId: Uint8Array, tag: Uint8Array): Buffer => derive(cacheKey, fileId, FILE_KEY_LABEL, tag);

/** The same derivation with `info = "cbp-mix-hdr-v1" || mix tag`: authenticates the header. */
export const headerKey = (cacheKey: Uint8Array, fileId: Uint8Array, tag: Uint8Array): Buffer => derive(cacheKey, fileId, HEADER_KEY_LABEL, tag);

/** The nonce is the chunk index as 96 big-endian bits. */
export function nonceOf(index: number): Buffer {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("bad chunk index");
  const n = Buffer.alloc(12);
  n.writeBigUInt64BE(BigInt(index), 4);
  return n;
}

/** Additional data: file id, mix tag, chunk index (64 bits) and the final-chunk flag. */
export function aadOf(fileId: Uint8Array, tag: Uint8Array, index: number, final: boolean): Buffer {
  const i = Buffer.alloc(9);
  i.writeBigUInt64BE(BigInt(index), 0);
  i[8] = final ? 1 : 0;
  return Buffer.concat([fileId, tag, i]);
}

/** Where a chunk sits: which file, which mix, which index, and whether it is the last one. */
export interface ChunkPlace {
  readonly key: Uint8Array;
  readonly fileId: Uint8Array;
  readonly tag: Uint8Array;
  readonly index: number;
  readonly final: boolean;
}

/** The sealed chunk: ciphertext followed by the 16-byte GCM tag. */
export function sealChunk(p: ChunkPlace, plain: Uint8Array): Buffer {
  const c = createCipheriv("aes-256-gcm", p.key, nonceOf(p.index));
  c.setAAD(aadOf(p.fileId, p.tag, p.index, p.final));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([body, c.getAuthTag()]);
}

/** The plaintext, or null when the chunk fails authentication in any way. */
export function openChunk(p: ChunkPlace, sealed: Uint8Array): Buffer | null {
  if (sealed.length < GCM_TAG_BYTES) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", p.key, nonceOf(p.index));
    d.setAAD(aadOf(p.fileId, p.tag, p.index, p.final));
    d.setAuthTag(sealed.subarray(sealed.length - GCM_TAG_BYTES));
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - GCM_TAG_BYTES)), d.final()]);
  } catch {
    return null;
  }
}

/** HMAC-SHA256 of the header's canonical bytes. */
export const headerMac = (key: Uint8Array, canonical: Uint8Array): Buffer => createHmac("sha256", key).update(canonical).digest();

/** Constant-time equality of two MACs. */
export function sameMac(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
