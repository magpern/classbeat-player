// The running-class fixture must be a class the product would open: it is run through the real class
// schema (schema/class-format/v1/class.schema.json) and the format's semantic rules (schema/ts), the
// same checks as the player's loader in reader mode, so the fixture cannot drift from the format again
// (issue #802). The valid running example is checked too, as the control that the check can pass.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { checkSemantics } from "../../../schema/ts/src/semantic.ts";
import { RUNNING_FIXTURES, runningClass } from "../../src/fixtures/running-class.ts";

const V1 = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schema", "class-format", "v1");
const schema = JSON.parse(readFileSync(join(V1, "class.schema.json"), "utf8"));
const example = JSON.parse(readFileSync(join(V1, "examples", "valid", "class-running-treadmill.json"), "utf8"));

/** Schema errors and semantic violations as text; empty means valid. */
function problems(doc: unknown): string[] {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  if (!validate(doc)) return (validate.errors ?? []).map((e) => `schema at ${e.instancePath || "/"}: ${e.message}`);
  return checkSemantics(doc as never).map(([code, pointer]) => `${code} at ${pointer || "/"}`);
}

describe("the running-class fixture follows the class format", () => {
  it("the valid running example passes (the check can pass)", () => {
    assert.deepEqual(problems(example), []);
  });

  it("runningClass() is a valid class", () => {
    assert.deepEqual(problems(runningClass()), []);
  });

  it("the document of every running snapshot is valid", () => {
    for (const [name, input] of Object.entries(RUNNING_FIXTURES)) assert.deepEqual(problems(input.doc), [], name);
  });

  it("the check fails on the old fault: a sixth zone for a running class", () => {
    const good = runningClass();
    const doc = { ...good, zone_scale: [...good.zone_scale, { ...good.zone_scale[4], zone: 6, name: "Extra" }] };
    assert.ok(problems(doc).some((p) => p.startsWith("zone_out_of_range_for_sport")));
  });
});
