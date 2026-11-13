// What the player API answers (schema/player-api/v1; ADR 0002, sections 6 and 7), read strictly.
// Pure: the content hash is a calculation (classformat's hashing, no I/O). Anything that is not
// exactly an expected answer is "unexpected": the app never guesses, and never deletes on it.
import { checkDocument, contentHash } from "classformat/src/index.ts";
import type { HttpAnswer } from "../pairing/protocol.ts";

/** A class the account holds now, or a removal marker, as one page lists it. No content. */
export interface Change {
  readonly id: string;
  readonly removed: boolean;
  /** Null for a removal. */
  readonly hash: string | null;
  readonly position: number;
}

/** Why an answer is not a result. Only `gone` ever leads to deleting anything. */
export type Refusal =
  /** No answer at all: a normal state, the cache is played as it is. */
  | { readonly kind: "offline" }
  /** A rate limit (429, with its Retry-After) or a server fault (5xx): ask again later. */
  | { readonly kind: "retry"; readonly afterMs: number | null }
  /** `token_revoked` or `token_unknown`: the pairing is gone for good. */
  | { readonly kind: "gone" }
  /** `token_expired`: 180 days without use; pair again. */
  | { readonly kind: "expired" }
  | { readonly kind: "unexpected" };

export type ListResult = { readonly kind: "page"; readonly changes: readonly Change[]; readonly cursor: number; readonly more: boolean } | { readonly kind: "resync" } | Refusal;

export type FetchResult =
  | { readonly kind: "class"; readonly hash: string; readonly document: Readonly<Record<string, unknown>> }
  /** Removed (or never this account's) since the page was listed. */
  | { readonly kind: "not_found" }
  /** An answer from the server that is not a class to keep: skipped, the cached copy kept. */
  | { readonly kind: "unusable" }
  | Refusal;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** The contract's page cap, and a bound on a source id the contract leaves open. */
const MAX_SOURCE = 10_000;
export const PAGE_MAX = 500;

export const isClassId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const hasOnly = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
/** A JSON integer this side can hold exactly. Larger places than 2^53 are refused, never rounded. */
const whole = (v: unknown, min: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const text = (v: unknown, max: number): boolean => typeof v === "string" && v.length >= 1 && v.length <= max;

const CHANGE_KEYS = ["class_id", "source", "source_class_id", "publication_number", "removed", "content_hash", "published_at", "position"] as const;
const PAGE_KEYS = ["changes", "cursor", "more"] as const;
const CLASS_KEYS = ["class_id", "source", "source_class_id", "publication_number", "content_hash", "position", "document"] as const;

function refusal(a: HttpAnswer): Refusal {
  if (a.kind === "unreachable") return { kind: "offline" };
  if (a.status === 429 || a.status >= 500) return { kind: "retry", afterMs: a.retryAfterS === null ? null : a.retryAfterS * 1000 };
  const code = isObject(a.body) ? a.body.error : undefined;
  if (a.status === 401 && (code === "token_revoked" || code === "token_unknown")) return { kind: "gone" };
  if (a.status === 401 && code === "token_expired") return { kind: "expired" };
  return { kind: "unexpected" };
}

function change(v: unknown): Change | null {
  if (!isObject(v) || !hasOnly(v, CHANGE_KEYS)) return null;
  const { class_id: id, removed, content_hash: hash, position } = v;
  if (!isClassId(id) || typeof removed !== "boolean" || !whole(position, 1) || !whole(v.publication_number, 1)) return null;
  if (!text(v.source, MAX_SOURCE) || !text(v.source_class_id, 100) || typeof v.published_at !== "string" || !STAMP.test(v.published_at)) return null;
  // A removal has no hash; a class always has one.
  if (removed ? hash !== null : typeof hash !== "string" || !HASH.test(hash)) return null;
  return { id, removed, hash: removed ? null : (hash as string), position };
}

/**
 * `GET /api/player/changes?after=<after>`: one page in sync order. Beyond the schema, a page must
 * make sense for the cursor it was asked with: places only grow and lie above `after` and at or
 * below the page's cursor, a class is listed once, and a page with more to follow moves the cursor
 * (or the app would ask for the same page for ever).
 */
export function parseChanges(a: HttpAnswer, after: number): ListResult {
  if (a.kind === "http" && a.status === 409 && isObject(a.body) && hasOnly(a.body, ["error", "cursor"]) && a.body.error === "resync_required" && whole(a.body.cursor, 0)) return { kind: "resync" };
  if (a.kind !== "http" || a.status !== 200) return refusal(a);
  const body = a.body;
  if (!isObject(body) || !hasOnly(body, PAGE_KEYS) || !Array.isArray(body.changes) || body.changes.length > PAGE_MAX) return { kind: "unexpected" };
  const { cursor, more } = body;
  if (!whole(cursor, after) || typeof more !== "boolean") return { kind: "unexpected" };
  const changes: Change[] = [];
  const ids = new Set<string>();
  let last = after;
  for (const raw of body.changes) {
    const c = change(raw);
    if (c === null || c.position <= last || c.position > cursor || ids.has(c.id)) return { kind: "unexpected" };
    changes.push(c);
    ids.add(c.id);
    last = c.position;
  }
  if (more && cursor === after) return { kind: "unexpected" };
  return { kind: "page", changes, cursor, more };
}

/**
 * `GET /api/player/classes/{id}`: the class with its document, kept only when the document's own
 * content hash (ADR 0003: sha256 over RFC 8785 JSON) is the one the answer states and the document
 * is a class in reader mode (ADR 0003, section 7). A newer version than the page listed is fine:
 * it is checked against its own answer, and listed again later. A document of a major this player
 * does not know is kept: opening it says the player needs updating, as a file from disk does.
 *
 * A JSON answer that is not such a class is `unusable`: that one class is skipped, so it cannot
 * hold back the rest of the account's changes (removals among them). An answer that is not JSON at
 * all is `unexpected`, as from anything that is not the server.
 */
export function parseClass(a: HttpAnswer, id: string, classSchema: unknown): FetchResult {
  if (a.kind === "http" && a.status === 404 && isObject(a.body) && hasOnly(a.body, ["error"]) && a.body.error === "not_found") return { kind: "not_found" };
  if (a.kind !== "http" || a.status !== 200) return refusal(a);
  const body = a.body;
  if (!isObject(body)) return { kind: "unexpected" };
  if (!hasOnly(body, CLASS_KEYS) || body.class_id !== id || !isObject(body.document)) return { kind: "unusable" };
  const { content_hash: hash, document } = body;
  if (typeof hash !== "string" || !HASH.test(hash) || !whole(body.position, 1) || !whole(body.publication_number, 1)) return { kind: "unusable" };
  if (!text(body.source, MAX_SOURCE) || !text(body.source_class_id, 100)) return { kind: "unusable" };
  try {
    if (contentHash(document) !== hash) return { kind: "unusable" };
    const violations = checkDocument(classSchema, document, "reader");
    return violations.every(([code]) => code === "unsupported_major") ? { kind: "class", hash, document } : { kind: "unusable" };
  } catch {
    return { kind: "unusable" };
  }
}
