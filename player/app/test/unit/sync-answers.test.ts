// Reading the player API's answers (core/sync/answers.ts): every recorded answer of the contract
// (schema/player-api/v1/examples) gets the reading its route gives it, and the table must name
// every example, so a new one cannot go untested.
import assert from "node:assert/strict";
import { test } from "node:test";
import { contentHash } from "classformat/src/index.ts";
import { parseChanges, parseClass } from "../../src/core/sync/answers.ts";
import type { FetchResult, ListResult } from "../../src/core/sync/answers.ts";
import { classSchema } from "./fixtures.ts";
import { allExamples, changeOf, classBody, document, err, example, ID_A, ID_B, OFFLINE, ok, page } from "./sync-fixtures.ts";

const changes = (rel: string, after = 0): ListResult => parseChanges(ok(example(rel)), after);
const held = (body: unknown, id = ID_A): FetchResult => parseClass(ok(body), id, classSchema);

/** Each example and what the app reads from it on the route it answers. */
const READINGS: Record<string, () => void> = {
  "changes/valid/empty.json": () => assert.deepEqual(changes("changes/valid/empty.json"), { kind: "page", changes: [], cursor: 0, more: false }),
  "changes/valid/more-follow.json": () =>
    assert.deepEqual(changes("changes/valid/more-follow.json"), { kind: "page", changes: [{ id: ID_A, removed: false, hash: `sha256:${"a".repeat(64)}`, position: 1 }], cursor: 1, more: true }),
  "changes/valid/page-with-class-and-removal.json": () =>
    assert.deepEqual(changes("changes/valid/page-with-class-and-removal.json"), {
      kind: "page",
      changes: [
        { id: ID_A, removed: false, hash: `sha256:${"a".repeat(64)}`, position: 1 },
        { id: ID_B, removed: true, hash: null, position: 2 },
      ],
      cursor: 2,
      more: false,
    }),
  "changes/invalid/carries-content.json": () => assert.equal(changes("changes/invalid/carries-content.json").kind, "unexpected"),
  "changes/invalid/class-without-hash.json": () => assert.equal(changes("changes/invalid/class-without-hash.json").kind, "unexpected"),
  "changes/invalid/more-missing.json": () => assert.equal(changes("changes/invalid/more-missing.json").kind, "unexpected"),
  "changes/invalid/negative-cursor.json": () => assert.equal(changes("changes/invalid/negative-cursor.json").kind, "unexpected"),
  "changes/invalid/removal-with-hash.json": () => assert.equal(changes("changes/invalid/removal-with-hash.json").kind, "unexpected"),
  // The example's hash is a placeholder, not its document's: as recorded it is not kept. With its
  // document's own hash it is.
  "class/valid/short-class.json": () => {
    const body = example("class/valid/short-class.json");
    assert.deepEqual(held(body), { kind: "unusable" });
    const real = { ...body, content_hash: contentHash(body.document) };
    assert.deepEqual(held(real), { kind: "class", hash: real.content_hash, document: body.document });
  },
  "class/invalid/document-missing.json": () => assert.deepEqual(held(example("class/invalid/document-missing.json")), { kind: "unusable" }),
  "class/invalid/hash-null.json": () => assert.deepEqual(held(example("class/invalid/hash-null.json")), { kind: "unusable" }),
  // Not a class even with its own hash: the reader-mode check refuses it.
  "class/invalid/document-not-a-class.json": () => {
    const body = example("class/invalid/document-not-a-class.json");
    assert.deepEqual(held({ ...body, content_hash: contentHash(body.document) }), { kind: "unusable" });
  },
  // The cursor route is not one sync asks: a page's own cursor and a resync from 0 are enough. A
  // cursor answer where a page or a class belongs is not read as one.
  "cursor/valid/forty-one.json": () => assert.equal(changes("cursor/valid/forty-one.json").kind, "unexpected"),
  "cursor/valid/zero.json": () => assert.equal(held(example("cursor/valid/zero.json")).kind, "unusable"),
  "cursor/invalid/missing.json": () => assert.equal(changes("cursor/invalid/missing.json").kind, "unexpected"),
  "cursor/invalid/text.json": () => assert.equal(changes("cursor/invalid/text.json").kind, "unexpected"),
  "error/valid/not-found.json": () => {
    assert.deepEqual(parseClass(err(404, example("error/valid/not-found.json")), ID_A, classSchema), { kind: "not_found" });
    assert.equal(parseChanges(err(404, example("error/valid/not-found.json")), 0).kind, "unexpected");
  },
  "error/valid/resync-required.json": () => assert.deepEqual(parseChanges(err(409, example("error/valid/resync-required.json")), 9), { kind: "resync" }),
  "error/valid/too-many-requests.json": () => {
    const body = example("error/valid/too-many-requests.json");
    assert.deepEqual(parseChanges(err(429, body, 30), 0), { kind: "retry", afterMs: 30_000 });
    assert.deepEqual(parseClass(err(429, body), ID_A, classSchema), { kind: "retry", afterMs: null });
  },
  "error/invalid/resync-without-cursor.json": () => assert.equal(parseChanges(err(409, example("error/invalid/resync-without-cursor.json")), 0).kind, "unexpected"),
  "error/invalid/cursor-on-other-error.json": () => assert.equal(parseClass(err(404, example("error/invalid/cursor-on-other-error.json")), ID_A, classSchema).kind, "unexpected"),
  "error/invalid/unknown-code.json": () => assert.equal(parseChanges(err(401, example("error/invalid/unknown-code.json")), 0).kind, "unexpected"),
  "error/invalid/no-code.json": () => assert.equal(parseChanges(err(401, example("error/invalid/no-code.json")), 0).kind, "unexpected"),
};

test("the table names every recorded answer of the contract", () => {
  assert.deepEqual(Object.keys(READINGS).sort(), allExamples().sort());
});

for (const [rel, check] of Object.entries(READINGS)) test(`recorded answer ${rel}`, check);

test("the three token-gone codes: revoked and unknown are gone for good, expired is its own", () => {
  for (const parse of [(a: Parameters<typeof parseChanges>[0]) => parseChanges(a, 0), (a: Parameters<typeof parseChanges>[0]) => parseClass(a, ID_A, classSchema)]) {
    assert.deepEqual(parse(err(401, { error: "token_revoked" })), { kind: "gone" });
    assert.deepEqual(parse(err(401, { error: "token_unknown" })), { kind: "gone" });
    assert.deepEqual(parse(err(401, { error: "token_expired" })), { kind: "expired" });
    // Only a 401 says so: the same code with any other status, or invalid_token, deletes nothing.
    assert.deepEqual(parse(err(403, { error: "token_revoked" })), { kind: "unexpected" });
    assert.deepEqual(parse(err(401, { error: "invalid_token" })), { kind: "unexpected" });
  }
});

test("no answer is offline; a server fault is asked again later", () => {
  assert.deepEqual(parseChanges(OFFLINE, 0), { kind: "offline" });
  assert.deepEqual(parseClass(OFFLINE, ID_A, classSchema), { kind: "offline" });
  assert.deepEqual(parseChanges(err(503, undefined, 5), 0), { kind: "retry", afterMs: 5000 });
  assert.deepEqual(parseChanges(err(500, { error: "internal_error" }), 0), { kind: "retry", afterMs: null });
});

test("a page must make sense for its cursor", () => {
  const a = changeOf(ID_A, 5, document());
  const b = changeOf(ID_B, 6, null);
  assert.equal(parseChanges(ok(page([a, b], 6)), 4).kind, "page");
  // At or below the cursor asked after, out of order, past the page's cursor, or listed twice.
  assert.equal(parseChanges(ok(page([a], 5)), 5).kind, "unexpected");
  assert.equal(parseChanges(ok(page([b, a], 6)), 4).kind, "unexpected");
  assert.equal(parseChanges(ok(page([a, b], 5)), 4).kind, "unexpected");
  assert.equal(parseChanges(ok(page([a, { ...a, position: 6 }], 6)), 4).kind, "unexpected");
  // A cursor behind the one asked, more to follow with a cursor that does not move, a place past 2^53.
  assert.equal(parseChanges(ok(page([], 3)), 4).kind, "unexpected");
  assert.equal(parseChanges(ok(page([], 4, true)), 4).kind, "unexpected");
  assert.equal(parseChanges(ok(page([], 2 ** 53)), 0).kind, "unexpected");
  // An unknown field, or more than the contract's 500 changes.
  assert.equal(parseChanges(ok({ ...page([], 4), extra: 1 }), 4).kind, "unexpected");
  assert.equal(parseChanges(ok(page(Array.from({ length: 501 }, (_, i) => changeOf(ID_A, i + 1, null)), 501)), 0).kind, "unexpected");
});

test("a class is kept only for the id asked, with its own hash", () => {
  const doc = document();
  assert.equal(held(classBody(ID_A, doc)).kind, "class");
  assert.equal(held(classBody(ID_A, doc), ID_B).kind, "unusable");
  assert.equal(held({ ...classBody(ID_A, doc), content_hash: contentHash(document("Other")) }).kind, "unusable");
  assert.equal(held({ ...classBody(ID_A, doc), extra: true }).kind, "unusable");
  // Not JSON at all (a body over the cap reads as none) is not the server's word on the class.
  assert.equal(held(undefined).kind, "unexpected");
});

test("a class of a newer major is kept, for the player to say it needs updating when opened", () => {
  const doc = { ...document(), format_version: "2.0" };
  assert.equal(held(classBody(ID_A, doc)).kind, "class");
});
