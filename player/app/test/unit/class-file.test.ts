// Opening class files: the example classes validate, wrong files get a plain message
// (ADR 0003 section 7: reader mode for files the player reads, strict for files it writes).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import {
  INVALID_MESSAGE,
  MAX_CLASS_FILE_BYTES,
  NEWER_VERSION_MESSAGE,
  NOT_JSON_MESSAGE,
  readClassText,
  TOO_LARGE_MESSAGE,
  violationsForWriting,
} from "../../src/core/class-file.ts";
import { classSchema, converterExamples, EXAMPLES } from "./fixtures.ts";

const text = (path: string): string => readFileSync(path, "utf8");

test("there are at least three converted example classes", () => {
  assert.ok(converterExamples().length >= 3);
});

for (const path of converterExamples()) {
  test(`converted example class opens: ${basename(path)}`, () => {
    const r = readClassText(text(path), classSchema);
    assert.equal(r.ok, true, JSON.stringify(r));
    if (r.ok) assert.deepEqual(violationsForWriting(r.doc, classSchema), []);
  });
}

for (const name of readdirSync(join(EXAMPLES, "valid")).sort()) {
  test(`valid example class opens: ${name}`, () => {
    assert.equal(readClassText(text(join(EXAMPLES, "valid", name)), classSchema).ok, true);
  });
}

test("reader mode: a future minor version with unknown fields opens", () => {
  const r = readClassText(text(join(EXAMPLES, "reader", "accepted-future-minor-unknown-fields.json")), classSchema);
  assert.equal(r.ok, true);
});

test("strict for writing: the same future-minor document is refused", () => {
  const doc = JSON.parse(text(join(EXAMPLES, "reader", "accepted-future-minor-unknown-fields.json")));
  assert.notDeepEqual(violationsForWriting(doc, classSchema), []);
});

test("an unknown major version gets the plain 'newer version' message", () => {
  const r = readClassText(text(join(EXAMPLES, "reader", "rejected-unknown-major.json")), classSchema);
  assert.deepEqual(r, { ok: false, message: NEWER_VERSION_MESSAGE, details: [] });
  assert.equal(NEWER_VERSION_MESSAGE, "This class needs a newer version of the player.");
});

test("a malformed version string is an invalid class, not a newer one", () => {
  const r = readClassText(text(join(EXAMPLES, "reader", "rejected-bad-version-string.json")), classSchema);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.message, INVALID_MESSAGE);
});

const invalidDir = join(EXAMPLES, "invalid");
// Invalid only for producers: a reader ignores unknown fields and accepts a later minor
// (ADR 0003 section 7). The player never shows an unknown field, so a source's games stay out.
const STRICT_ONLY = new Set(["schema-strict-refuses-minor-1-1.json", "schema-unknown-field-games.json", "schema-unknown-nested-field-colour.json"]);
for (const name of [...STRICT_ONLY]) {
  test(`reader accepts, writer refuses: ${name}`, () => {
    const t = text(join(invalidDir, name));
    assert.equal(readClassText(t, classSchema).ok, true);
    assert.notDeepEqual(violationsForWriting(JSON.parse(t), classSchema), []);
  });
}
for (const name of readdirSync(invalidDir).filter((n) => n !== "expected.json" && !STRICT_ONLY.has(n)).sort()) {
  test(`invalid example is refused with its reasons: ${name}`, () => {
    const r = readClassText(text(join(invalidDir, name)), classSchema);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.message, INVALID_MESSAGE);
      assert.ok(r.details.length >= 1 && r.details.length <= 5);
    }
  });
}

for (const [label, input] of [
  ["empty", ""],
  ["not JSON", "{ not json"],
  ["truncated", '{"format_version": "1.0", '],
] as const) {
  test(`not JSON (${label}) is refused plainly`, () => {
    assert.deepEqual(readClassText(input, classSchema), { ok: false, message: NOT_JSON_MESSAGE, details: [] });
  });
}

for (const [label, input] of [
  ["null", "null"],
  ["a number", "42"],
  ["an array", "[]"],
  ["an empty object", "{}"],
] as const) {
  test(`JSON that is not a class (${label}) is refused`, () => {
    const r = readClassText(input, classSchema);
    assert.equal(r.ok, false);
  });
}

test("a file over the size limit is refused before parsing", () => {
  const big = " ".repeat(MAX_CLASS_FILE_BYTES + 1);
  assert.deepEqual(readClassText(big, classSchema), { ok: false, message: TOO_LARGE_MESSAGE, details: [] });
});

test("the size limit counts UTF-8 bytes, not characters", () => {
  const big = `"${"é".repeat(MAX_CLASS_FILE_BYTES / 2)}"`;
  assert.equal(readClassText(big, classSchema).ok, false);
  const r = readClassText(big, classSchema);
  if (!r.ok) assert.equal(r.message, TOO_LARGE_MESSAGE);
});
