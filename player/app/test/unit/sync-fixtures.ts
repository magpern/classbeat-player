// The player API's recorded answers (schema/player-api/v1/examples, read-only from the contract
// lane) and answers built from them for class sync's tests.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { contentHash } from "classformat/src/index.ts";
import type { HttpAnswer } from "../../src/core/pairing/protocol.ts";
import { readJson, SCHEMA_DIR } from "./fixtures.ts";

export const API_EXAMPLES = join(SCHEMA_DIR, "player-api", "v1", "examples");

/** Every example, as `<answer>/<valid|invalid>/<file>`. */
export const allExamples = (): string[] =>
  readdirSync(API_EXAMPLES).flatMap((name) => ["valid", "invalid"].flatMap((kind) => readdirSync(join(API_EXAMPLES, name, kind)).map((f) => `${name}/${kind}/${f}`)));

export const example = (rel: string): Record<string, unknown> => readJson(join(API_EXAMPLES, rel)) as Record<string, unknown>;

export const ok = (body: unknown): HttpAnswer => ({ kind: "http", status: 200, body, retryAfterS: null });
export const err = (status: number, body: unknown, retryAfterS: number | null = null): HttpAnswer => ({ kind: "http", status, body, retryAfterS });
export const OFFLINE: HttpAnswer = { kind: "unreachable" };

export const ID_A = "11111111-1111-4111-8111-111111111111";
export const ID_B = "22222222-2222-4222-8222-222222222222";
export const ID_C = "33333333-3333-4333-8333-333333333333";
/** The publication time every `changeOf` carries. */
export const STAMP = "2026-11-01T10:00:00+00:00";

/** The example class's document, retitled so each version has its own hash. */
export function document(title = "Quick spin"): Record<string, unknown> {
  const doc = structuredClone(example("class/valid/short-class.json").document) as Record<string, unknown>;
  (doc.class as Record<string, unknown>).title = title;
  return doc;
}

/** A class answer whose stated hash is its document's own. */
export function classBody(id: string, doc: Record<string, unknown>, position = 1): Record<string, unknown> {
  return { class_id: id, source: "classbeat", source_class_id: `src-${id.slice(0, 4)}`, publication_number: position, content_hash: contentHash(doc), position, document: doc };
}

export function changeOf(id: string, position: number, doc: Record<string, unknown> | null): Record<string, unknown> {
  return {
    class_id: id,
    source: "classbeat",
    source_class_id: `src-${id.slice(0, 4)}`,
    publication_number: position,
    removed: doc === null,
    content_hash: doc === null ? null : contentHash(doc),
    published_at: STAMP,
    position,
  };
}

export const page = (changes: Record<string, unknown>[], cursor: number, more = false): Record<string, unknown> => ({ changes, cursor, more });
