// Reading and checking a class file (ADR 0003 section 7). Pure: takes the file's text and the
// class schema, returns the document or a plain message. The caller reads the file.
// Documents the player reads are checked in reader mode (any minor of a known major, unknown
// fields ignored); documents it writes are checked strictly.
import { checkDocument } from "classformat/src/index.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";

/** Larger than any real class by far; refuses a wrong file before parsing it. */
export const MAX_CLASS_FILE_BYTES = 5 * 1024 * 1024;
/** How many violations a message lists at most. */
export const MAX_LISTED = 5;

export const NEWER_VERSION_MESSAGE = "This class needs a newer version of the player.";
export const NOT_JSON_MESSAGE = "This file is not a class file: it is not JSON.";
export const TOO_LARGE_MESSAGE = "This file is too large to be a class file.";
export const INVALID_MESSAGE = "This class file is not valid.";

export type ReadResult =
  | { readonly ok: true; readonly doc: Class }
  | { readonly ok: false; readonly message: string; readonly details: readonly string[] };

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/** Reads a class file's text (reader mode). Never throws. */
export function readClassText(text: string, classSchema: unknown): ReadResult {
  if (typeof text !== "string" || byteLength(text) > MAX_CLASS_FILE_BYTES) {
    return { ok: false, message: TOO_LARGE_MESSAGE, details: [] };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, message: NOT_JSON_MESSAGE, details: [] };
  }
  let violations: readonly (readonly [string, string])[];
  try {
    violations = checkDocument(classSchema, doc, "reader");
  } catch {
    return { ok: false, message: INVALID_MESSAGE, details: [] };
  }
  if (violations.some(([code]) => code === "unsupported_major")) {
    return { ok: false, message: NEWER_VERSION_MESSAGE, details: [] };
  }
  if (violations.length > 0) {
    const details = violations.slice(0, MAX_LISTED).map(([code, pointer]) => `${code} at ${pointer || "/"}`);
    return { ok: false, message: INVALID_MESSAGE, details };
  }
  return { ok: true, doc: doc as Class };
}

/** The check for a document the player writes: strict, the exact version, no unknown fields. */
export function violationsForWriting(doc: unknown, classSchema: unknown): readonly (readonly [string, string])[] {
  return checkDocument(classSchema, doc, "strict");
}
