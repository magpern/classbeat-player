// Where each sealed chunk sits in a mix's data file (ADR 0013 section 3). Pure arithmetic. The
// plaintext is cut into 256 KiB chunks; each is stored as ciphertext plus a 16-byte tag, in order,
// so record i starts at i * (CHUNK + TAG) and only the last one is shorter.
import { CHUNK_BYTES, GCM_TAG_BYTES } from "./cache-crypto.ts";

/** How many chunks a mix of `byteLength` bytes has (1 or more for a non-empty mix). */
export const chunkCount = (byteLength: number): number => Math.ceil(byteLength / CHUNK_BYTES);

/** Where the plaintext of the first `n` chunks ends. */
export const plainEnd = (byteLength: number, n: number): number => Math.min(n * CHUNK_BYTES, byteLength);

/** Where the sealed records of the first `n` chunks end in the data file. */
export const sealedEnd = (byteLength: number, n: number): number => plainEnd(byteLength, n) + n * GCM_TAG_BYTES;

/** Where record `i` starts. */
export const sealedStart = (i: number): number => i * (CHUNK_BYTES + GCM_TAG_BYTES);

/** The plaintext length of chunk `i`. */
export const plainLength = (byteLength: number, i: number): number => plainEnd(byteLength, i + 1) - plainEnd(byteLength, i);

/** How many whole records a data file of `fileSize` bytes holds; bytes after them are a torn record. */
export function wholeChunks(byteLength: number, fileSize: number): number {
  const count = chunkCount(byteLength);
  let n = Math.min(count, Math.floor(fileSize / (CHUNK_BYTES + GCM_TAG_BYTES)));
  while (n < count && sealedEnd(byteLength, n + 1) <= fileSize) n++;
  while (n > 0 && sealedEnd(byteLength, n) > fileSize) n--;
  return n;
}
