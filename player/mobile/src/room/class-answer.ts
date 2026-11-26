// The class the room screen opens (issue #871): native code's answer to getClass, read strictly.
// Native code answers {document} with the class it saved, {error: "not_found"} when there is none,
// or nothing (null, a refusal) for an id it will not look up (InstructorIntents.kt). The document is
// then checked by the class format's reader-only entry (schema/ts/src/reader.ts), whose validator is
// compiled at build time: the page's CSP allows no run-time code generation (ADR 0011, section 4).
// Anything else counts as no class: nothing is guessed and no fixture stands in. Pure.
import { checkClassDocument } from "../../../../schema/ts/src/reader.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import type { NoClass } from "./plate-words.ts";

export type ClassAnswer = { readonly ok: true; readonly doc: Class } | { readonly ok: false; readonly why: NoClass };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** The answer's class, checked in reader mode as the desktop reads a file, or why there is none. */
export function readClassAnswer(answer: unknown): ClassAnswer {
  if (!isPlainObject(answer)) return { ok: false, why: "missing" };
  const keys = Object.keys(answer);
  if (keys.length !== 1 || keys[0] !== "document") return { ok: false, why: "missing" };
  const doc = answer.document;
  if (!isPlainObject(doc)) return { ok: false, why: "invalid" };
  let violations: readonly (readonly [string, string])[];
  try {
    violations = checkClassDocument(doc);
  } catch {
    return { ok: false, why: "invalid" };
  }
  if (violations.some(([code]) => code === "unsupported_major")) return { ok: false, why: "newer" };
  return violations.length === 0 ? { ok: true, doc: doc as unknown as Class } : { ok: false, why: "invalid" };
}
