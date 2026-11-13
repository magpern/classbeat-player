// What the class list window may ask the shell: to start a class, by id and hash, and nothing else
// with an argument. Pure. Anything not exactly this shape is refused (null).
import { isClassId } from "../sync/answers.ts";

export interface StartRequest {
  readonly id: string;
  readonly hash: string;
}

/** A hash is compared with the one sync holds, so only its size is bounded here. */
const MAX_HASH_LENGTH = 100;

export function parseStartRequest(v: unknown): StartRequest | null {
  if (v === null || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) return null;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes("id") || !keys.includes("hash")) return null;
  const { id, hash } = v as Record<string, unknown>;
  return isClassId(id) && typeof hash === "string" && hash.length > 0 && hash.length <= MAX_HASH_LENGTH ? { id, hash } : null;
}
