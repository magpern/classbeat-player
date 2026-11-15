// The passkeys answer (schema/site-api/v1/passkeys.schema.json): the account's passkeys and
// `can_add`, whether its kind may add one (ADR 0010, section 7), and nothing else. Typed literals
// check the generated TypeScript type (npm run typecheck). The examples' verdicts are checked in
// site-api.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Passkey, PasskeysAnswer } from "../../generated/ts/site-api-passkeys.d.ts";

const SCHEMA = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "site-api",
  "v1",
  "passkeys.schema.json",
);
const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const KEY: Passkey = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Laptop",
  created_at: "2026-11-15T03:08:17.123456+00:00",
  last_used_at: null,
};

test("the answer is the passkeys and can_add only", () => {
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["passkeys", "can_add"]);
  assert.deepEqual(Object.keys(schema.properties), ["passkeys", "can_add"]);
  assert.deepEqual(schema.properties.can_add, { type: "boolean" });
  const item = schema.properties.passkeys.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(Object.keys(item.properties), ["id", "name", "created_at", "last_used_at"]);
});

test("can_add is true or false, and nothing else", () => {
  assert.equal(validate({ passkeys: [], can_add: true }), true);
  assert.equal(validate({ passkeys: [KEY], can_add: false }), true);
  for (const can_add of [null, "true", "false", "", 1, 0, [], {}]) {
    assert.equal(validate({ passkeys: [], can_add }), false, JSON.stringify(can_add));
  }
  assert.equal(validate({ passkeys: [] }), false);
  assert.equal(validate({ can_add: false }), false);
});

test("the answer and a passkey refuse any extra field", () => {
  for (const extra of [{ kind: "instructor" }, { account_id: "x" }, { email: "r@example.com" }]) {
    assert.equal(validate({ passkeys: [], can_add: false, ...extra }), false);
  }
  for (const extra of [{ credential_id: "AAAA" }, { public_key: "pQEC" }, { sign_count: 0 }]) {
    assert.equal(validate({ passkeys: [{ ...KEY, ...extra }], can_add: false }), false);
  }
});

test("a literal of the generated type is a valid answer", () => {
  const open: PasskeysAnswer = { passkeys: [], can_add: true };
  const closed: PasskeysAnswer = { passkeys: [KEY], can_add: false };
  // @ts-expect-error The generated type requires can_add.
  const missing: PasskeysAnswer = { passkeys: [] };
  // @ts-expect-error The generated type's can_add is a boolean.
  const text: PasskeysAnswer = { passkeys: [], can_add: "true" };
  // @ts-expect-error The generated type allows no field besides the passkeys and can_add.
  const extra: PasskeysAnswer = { passkeys: [], can_add: false, kind: "instructor" };
  // @ts-expect-error A passkey carries no credential id.
  const leak: Passkey = { ...KEY, credential_id: "AAAA" };
  assert.equal(validate(open), true);
  assert.equal(validate(closed), true);
  assert.equal(validate(missing), false);
  assert.equal(validate(text), false);
  assert.equal(validate(extra), false);
  assert.equal(validate({ passkeys: [leak], can_add: false }), false);
});
