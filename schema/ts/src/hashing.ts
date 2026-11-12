// Content hash of a class document: sha256 over RFC 8785 canonical JSON. No I/O.
import { createHash } from "node:crypto";
import canonicalizeModule from "canonicalize";

// The package is CommonJS (`module.exports = fn`) with a typing that says `export default`;
// under NodeNext the default import is the function itself, but TypeScript types it as a module.
const canonicalize = canonicalizeModule as unknown as (input: unknown) => string | undefined;

export function contentHash(document: unknown): string {
  const text = canonicalize(document);
  if (text === undefined) throw new Error("document is not JSON");
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}
