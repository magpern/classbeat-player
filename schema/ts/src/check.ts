// Whole-document checks: JSON Schema plus the semantic rules, strict or lax.
// Twin of check.py. Producers use "strict"; readers use "reader" (any minor of a known major,
// unknown fields ignored). The reader schema is derived from the strict one. Pure given the
// schema objects; the caller loads the files.
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv/dist/2020.js";
import { contentHash } from "./hashing.ts";
import { checkSemantics, sortViolations } from "./semantic.ts";
import type { Violation } from "./semantic.ts";

export type Mode = "strict" | "reader";
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const KNOWN_MAJOR = 1;

export function readerSchema(strict: Json): Json {
  const lax = structuredClone(strict);
  const relax = (node: Json): void => {
    if (Array.isArray(node)) {
      node.forEach(relax);
    } else if (node !== null && typeof node === "object") {
      if (node.additionalProperties === false) delete node.additionalProperties;
      Object.values(node).forEach(relax);
    }
  };
  relax(lax);
  if (lax.properties?.format_version) {
    lax.properties.format_version = { type: "string", pattern: "^1\\.\\d+$" };
  }
  return lax;
}

function schemaViolations(schema: Json, instance: unknown, prefix: string): Violation[] {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (validate(instance)) return [];
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (const e of validate.errors as ErrorObject[]) {
    const pointer = prefix + e.instancePath;
    if (!seen.has(pointer)) {
      seen.add(pointer);
      out.push(["schema", pointer]);
    }
  }
  return sortViolations(out);
}

function versionProblem(version: unknown): Violation | null {
  const m = typeof version === "string" ? /^(\d+)\.(\d+)$/.exec(version) : null;
  if (m === null) return ["schema", "/format_version"];
  if (Number(m[1]) !== KNOWN_MAJOR) return ["unsupported_major", "/format_version"];
  return null;
}

/** All violations of a class document; empty means valid. */
export function checkDocument(classSchema: Json, doc: Json, mode: Mode = "strict", prefix = ""): Violation[] {
  let schema = classSchema;
  if (mode === "reader") {
    const version = doc !== null && typeof doc === "object" ? doc.format_version : undefined;
    const problem = versionProblem(version);
    if (problem !== null) return [[problem[0], prefix + problem[1]]];
    schema = readerSchema(classSchema);
  }
  const found = schemaViolations(schema, doc, prefix);
  if (found.length > 0) return found;
  return checkSemantics(doc).map(([c, p]) => [c, prefix + p] as Violation);
}

function envelopeSchema(publicationSchema: Json, mode: Mode): Json {
  const env = structuredClone(publicationSchema);
  env.properties.document = { type: "object" };
  return mode === "reader" ? readerSchema(env) : env;
}

/** All violations of a publication; includes the document and the content hash. */
export function checkPublication(classSchema: Json, publicationSchema: Json, pub: Json, mode: Mode = "strict"): Violation[] {
  const found = schemaViolations(envelopeSchema(publicationSchema, mode), pub, "");
  if (found.length > 0) return found;
  if (pub.removed === true) return [];
  const docFound = checkDocument(classSchema, pub.document, mode, "/document");
  if (docFound.length > 0) return docFound;
  if (contentHash(pub.document) !== pub.content_hash) return [["hash_mismatch", "/content_hash"]];
  return [];
}
