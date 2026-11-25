// Every recorded snapshot the screens run on carries a class document; each must be a class the product
// would open: the real class schema plus the format's semantic rules (as in running-class-valid.test.ts,
// issue #804), so no fixture drifts from the format (issue #805).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { checkSemantics } from "../../../schema/ts/src/semantic.ts";
import { FIXTURES } from "../../src/fixtures/index.ts";

const V1 = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schema", "class-format", "v1");
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(join(V1, "class.schema.json"), "utf8")));

/** Schema errors and semantic violations as text; empty means valid. */
function problems(doc: unknown): string[] {
  if (!validate(doc)) return (validate.errors ?? []).map((e) => `schema at ${e.instancePath || "/"}: ${e.message}`);
  return checkSemantics(doc as never).map(([code, pointer]) => `${code} at ${pointer || "/"}`);
}

describe("every fixture snapshot's class follows the class format", () => {
  it("covers a non-empty set of snapshots", () => {
    assert.ok(Object.keys(FIXTURES).length > 10);
  });

  for (const [name, input] of Object.entries(FIXTURES)) {
    it(name, () => {
      assert.deepEqual(problems(input.doc), []);
    });
  }

  it("the check fails on a broken class (the guard can fail)", () => {
    const doc = Object.values(FIXTURES)[0].doc as { totals: { length_ms: number } };
    const bad = { ...doc, totals: { ...doc.totals, length_ms: doc.totals.length_ms + 1 } };
    assert.ok(problems(bad).length > 0);
  });
});
