// What the sign-in channel accepts (ADR 0013 section 1): exactly the fields the active source
// declares, each a string of 1 to 256 characters, and nothing else. Pure. The values are never
// copied anywhere but into the object handed back for the one `signIn` call.
import type { CredentialField, MixCredentials } from "./source.ts";

/** The most characters a field may hold; the page's fields refuse more as well. */
export const MAX_FIELD_CHARS = 256;

/**
 * The credentials, or null when the input is not exactly the declared fields: a non-object, an
 * array, an object with another prototype, a missing, extra or accessor key, a value that is not a
 * string, empty, or longer than the cap. A source that declares no field accepts nothing.
 */
export function parseCredentials(raw: unknown, fields: readonly CredentialField[]): MixCredentials | null {
  if (fields.length === 0) return null;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const proto: unknown = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== fields.length) return null;
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const f of fields) {
    const d = Object.getOwnPropertyDescriptor(raw, f.name);
    if (d === undefined || !("value" in d)) return null;
    const v: unknown = d.value;
    if (typeof v !== "string" || v.length === 0 || v.length > MAX_FIELD_CHARS) return null;
    out[f.name] = v;
  }
  return Object.freeze(out);
}
