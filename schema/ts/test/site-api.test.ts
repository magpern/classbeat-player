// The site's answers (schema/site-api/v1): every example gets its verdict from the JSON Schema,
// the /me answer allows the email and nothing else, and a typed literal checks the generated
// TypeScript type (npm run typecheck).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { MeAnswer } from "../../generated/ts/site-api-me.d.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = join(ROOT, "site-api", "v1");
const NAMES = ["me"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const names = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith(".json")).sort();

function validator(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(load(join(API, `${name}.schema.json`)));
}

test("every site schema is listed", () => {
  const schemas = readdirSync(API)
    .filter((n) => n.endsWith(".schema.json"))
    .map((n) => n.slice(0, -".schema.json".length))
    .sort();
  assert.deepEqual(schemas, NAMES);
});

for (const name of NAMES) {
  const validate = validator(name);
  for (const kind of ["valid", "invalid"]) {
    const dir = join(API, "examples", name, kind);
    test(`${name} has a ${kind} example`, () => {
      assert.ok(names(dir).length > 0);
    });
    for (const file of names(dir)) {
      test(`${kind} ${name} example: ${file}`, () => {
        assert.equal(validate(load(join(dir, file))), kind === "valid");
      });
    }
  }
}

test("the me answer is the email only", () => {
  const schema = load(join(API, "me.schema.json"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["email"]);
  assert.deepEqual(Object.keys(schema.properties), ["email"]);
  const validate = validator("me");
  for (const extra of [{ account_id: "x" }, { id: "x" }, { other_email: "o@example.com" }]) {
    assert.equal(validate({ email: "rider@example.com", ...extra }), false);
  }
});

test("a literal of the generated type is a valid answer", () => {
  const me: MeAnswer = { email: "rider@example.com" };
  // @ts-expect-error The generated type allows no field besides the email.
  const extra: MeAnswer = { email: "rider@example.com", account_id: "x" };
  assert.equal(validator("me")(me), true);
  assert.equal(validator("me")(extra), false);
});
