// The converter's expected documents are example classes for the player: both must validate here.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkDocument } from "../src/index.ts";

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = join(SCHEMA, "converter", "fixtures");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const classSchema = load(join(SCHEMA, "class-format", "v1", "class.schema.json"));
const expected = readdirSync(FIXTURES).filter((n) => n.endsWith(".expected.json")).sort();

test("there are at least three converted example classes", () => {
  assert.ok(expected.length >= 3);
});

for (const name of expected) {
  test(`converted example class validates in both modes: ${name}`, () => {
    const doc = load(join(FIXTURES, name));
    assert.deepEqual(checkDocument(classSchema, doc, "strict"), []);
    assert.deepEqual(checkDocument(classSchema, doc, "reader"), []);
  });
}
