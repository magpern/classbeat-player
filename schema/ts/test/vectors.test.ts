// Every shared vector must give the same verdict here and in the Python tests.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkDocument, checkPublication, contentHash, decide, readerSchema } from "../src/index.ts";
import type { Publication, Violation } from "../src/index.ts";

const V1 = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "class-format", "v1");
const EXAMPLES = join(V1, "examples");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const names = (dir: string): string[] =>
  readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "expected.json").sort();

const classSchema = load(join(V1, "class.schema.json"));
const publicationSchema = load(join(V1, "publication.schema.json"));

function judge(found: Violation[], expected: [string, string][]): void {
  assert.ok(found.length > 0, "must be rejected");
  if (expected.length > 0 && expected[0][0] === "schema") {
    assert.ok(
      found.some(([c, p]) => c === "schema" && p === expected[0][1]),
      `expected a schema error at "${expected[0][1]}", got ${JSON.stringify(found)}`,
    );
  } else {
    assert.deepEqual(found.map((v) => [...v]), expected);
  }
}

test("every invalid vector has an expectation and back", () => {
  for (const sub of ["invalid", "reader", join("publications", "invalid")]) {
    const dir = join(EXAMPLES, sub);
    assert.deepEqual(Object.keys(load(join(dir, "expected.json"))).sort(), names(dir));
  }
});

for (const name of names(join(EXAMPLES, "valid"))) {
  test(`valid document passes in both modes: ${name}`, () => {
    const doc = load(join(EXAMPLES, "valid", name));
    assert.deepEqual(checkDocument(classSchema, doc, "strict"), []);
    assert.deepEqual(checkDocument(classSchema, doc, "reader"), []);
  });
}

const invalidExpect = load(join(EXAMPLES, "invalid", "expected.json"));
for (const name of names(join(EXAMPLES, "invalid"))) {
  test(`invalid document fails for the named rule: ${name}`, () => {
    judge(checkDocument(classSchema, load(join(EXAMPLES, "invalid", name)), "strict"), invalidExpect[name]);
  });
}

const readerExpect = load(join(EXAMPLES, "reader", "expected.json"));
for (const name of names(join(EXAMPLES, "reader"))) {
  test(`reader vector: ${name}`, () => {
    const found = checkDocument(classSchema, load(join(EXAMPLES, "reader", name)), "reader");
    assert.deepEqual(found.map((v) => [...v]), readerExpect[name]);
  });
}

test("producer is strict where reader is lax", () => {
  const doc = load(join(EXAMPLES, "reader", "accepted-future-minor-unknown-fields.json"));
  assert.notDeepEqual(checkDocument(classSchema, doc, "strict"), []);
  doc.format_version = "1.0";
  assert.notDeepEqual(checkDocument(classSchema, doc, "strict"), []);
  assert.deepEqual(checkDocument(classSchema, doc, "reader"), []);
});

test("reader schema is derived, not a second source", () => {
  assert.equal("additionalProperties" in readerSchema(classSchema), false);
  assert.equal(classSchema.additionalProperties, false);
});

for (const name of names(join(EXAMPLES, "publications", "valid"))) {
  test(`valid publication: ${name}`, () => {
    const pub = load(join(EXAMPLES, "publications", "valid", name));
    assert.deepEqual(checkPublication(classSchema, publicationSchema, pub, "strict"), []);
    assert.deepEqual(checkPublication(classSchema, publicationSchema, pub, "reader"), []);
  });
}

const pubExpect = load(join(EXAMPLES, "publications", "invalid", "expected.json"));
for (const name of names(join(EXAMPLES, "publications", "invalid"))) {
  test(`invalid publication: ${name}`, () => {
    const pub = load(join(EXAMPLES, "publications", "invalid", name));
    judge(checkPublication(classSchema, publicationSchema, pub, "strict"), pubExpect[name]);
  });
}

test("content hash is the RFC 8785 form", () => {
  assert.equal(contentHash({ b: 1, a: [1.5, "x"] }), contentHash({ a: [1.5, "x"], b: 1 }));
  assert.equal(
    contentHash({ b: 1, a: [1.5, "x"] }),
    "sha256:27edd5497e48a293750749399a10333aae187927cecaf38c5ac50f54bbaa13b7",
  );
});

for (const c of load(join(EXAMPLES, "sequences.json")) as {
  name: string;
  stored: Publication | null;
  incoming: Publication;
  expect: string;
}[]) {
  test(`publication sequence: ${c.name}`, () => {
    assert.equal(decide(c.stored, c.incoming), c.expect);
  });
}
