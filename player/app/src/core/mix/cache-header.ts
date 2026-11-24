// A cached mix's header (ADR 0013 section 3): a small file in the clear with the format version,
// the file id, the mix tag (never the mix id or a title), the source file's identity as `describe`
// gave it, the chunk count, the state and when the mix was last used, authenticated by an
// HMAC under a key bound to the file id and mix tag. Pure: encoding, parsing and checking only.
import { chunkCount } from "./cache-layout.ts";
import { headerMac, sameMac } from "./cache-crypto.ts";
import type { MixDescription } from "./source.ts";

export const HEADER_FORMAT = 1;
export const MAX_HEADER_BYTES = 2048;
export type CacheState = "downloading" | "complete" | "bad";

export interface MixHeader {
  readonly fileId: string;
  readonly tag: string;
  readonly byteLength: number;
  readonly sha256: string | null;
  readonly sourceVersion: string | null;
  readonly state: CacheState;
  /** When the mix was last played, or downloaded if never played (ms since the epoch). */
  readonly usedAt: number;
}

/** The source's identity of the file: what a resume is checked against. */
export interface SourceIdentity {
  readonly byteLength: number;
  readonly sha256: string | null;
  readonly sourceVersion: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const VERSION = /^[\x21-\x7e]{1,128}$/;

/**
 * The identity a description states, or null when it is not one the cache accepts: a whole
 * length from 1 to `maxBytes`, a SHA-256 of 64 hex digits if given, a short printable version if given.
 */
export function identityOf(d: MixDescription, maxBytes: number): SourceIdentity | null {
  if (!Number.isSafeInteger(d.byteLength) || d.byteLength < 1 || d.byteLength > maxBytes) return null;
  const sha = d.sha256 === undefined ? null : typeof d.sha256 === "string" ? d.sha256.toLowerCase() : "";
  if (sha !== null && !HEX64.test(sha)) return null;
  const version = d.version === undefined ? null : d.version;
  if (version !== null && (typeof version !== "string" || !VERSION.test(version))) return null;
  return { byteLength: d.byteLength, sha256: sha, sourceVersion: version };
}

/**
 * A download resumes only from the same source file: the same length and the same SHA-256 and
 * version as recorded, with at least one of the two given. Anything else starts over.
 */
export function sameSource(h: SourceIdentity, now: SourceIdentity): boolean {
  if (h.sha256 === null && h.sourceVersion === null) return false;
  return h.byteLength === now.byteLength && h.sha256 === now.sha256 && h.sourceVersion === now.sourceVersion;
}

const canonical = (h: MixHeader): Buffer =>
  Buffer.from(JSON.stringify(["cbp-mix-header", HEADER_FORMAT, h.fileId, h.tag, h.byteLength, h.sha256, h.sourceVersion, chunkCount(h.byteLength), h.state, h.usedAt]), "utf8");

export function encodeHeader(h: MixHeader, macKey: Uint8Array): Buffer {
  const mac = headerMac(macKey, canonical(h)).toString("hex");
  const out = { format: HEADER_FORMAT, fileId: h.fileId, tag: h.tag, byteLength: h.byteLength, sha256: h.sha256, sourceVersion: h.sourceVersion, chunks: chunkCount(h.byteLength), state: h.state, usedAt: h.usedAt, mac };
  return Buffer.from(JSON.stringify(out), "utf8");
}

/** The header's fields and MAC as written, or null when the bytes are not a header of this format. Not yet authenticated. */
export function parseHeader(bytes: Uint8Array): { readonly header: MixHeader; readonly mac: Buffer } | null {
  if (bytes.length > MAX_HEADER_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.format !== HEADER_FORMAT) return null;
  const { fileId, tag, byteLength, sha256, sourceVersion, chunks, state, usedAt, mac } = o;
  if (typeof fileId !== "string" || !HEX64.test(fileId) || typeof tag !== "string" || !HEX64.test(tag)) return null;
  if (!Number.isSafeInteger(byteLength) || (byteLength as number) < 1 || chunks !== chunkCount(byteLength as number)) return null;
  if (sha256 !== null && (typeof sha256 !== "string" || !HEX64.test(sha256))) return null;
  if (sourceVersion !== null && (typeof sourceVersion !== "string" || !VERSION.test(sourceVersion))) return null;
  if (state !== "downloading" && state !== "complete" && state !== "bad") return null;
  if (!Number.isSafeInteger(usedAt) || (usedAt as number) < 0) return null;
  if (typeof mac !== "string" || !HEX64.test(mac)) return null;
  const header: MixHeader = { fileId, tag, byteLength: byteLength as number, sha256, sourceVersion, state, usedAt: usedAt as number };
  return { header, mac: Buffer.from(mac, "hex") };
}

/** The header, if its MAC verifies under `macKey` and it names `tag`; otherwise null. */
export function checkHeader(parsed: { readonly header: MixHeader; readonly mac: Buffer }, macKey: Uint8Array, tag: string): MixHeader | null {
  if (parsed.header.tag !== tag) return null;
  return sameMac(headerMac(macKey, canonical(parsed.header)), parsed.mac) ? parsed.header : null;
}
