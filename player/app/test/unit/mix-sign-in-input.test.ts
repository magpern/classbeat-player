// What the sign-in channel accepts (core/mix/sign-in-input.ts, ADR 0013 section 1): exactly the
// fields the source declares, each a non-empty string of at most 256 characters.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_FIELD_CHARS, parseCredentials } from "../../src/core/mix/sign-in-input.ts";
import type { CredentialField } from "../../src/core/mix/source.ts";

const FIELDS: CredentialField[] = [
  { name: "username", secret: false },
  { name: "password", secret: true },
];

test("exactly the declared fields come back, frozen, with no prototype", () => {
  const c = parseCredentials({ username: "ana.k", password: "pw" }, FIELDS);
  assert.deepEqual({ ...c }, { username: "ana.k", password: "pw" });
  assert.ok(c !== null && Object.isFrozen(c) && Object.getPrototypeOf(c) === null);
  assert.notEqual(parseCredentials({ username: "u".repeat(MAX_FIELD_CHARS), password: "p" }, FIELDS), null);
});

test("oversize, missing, extra, odd and empty input is refused", () => {
  const getter = Object.defineProperty({ username: "u" }, "password", { get: () => "p", enumerable: true });
  const bad: unknown[] = [
    undefined,
    null,
    "username=u&password=p",
    42,
    [],
    ["u", "p"],
    {},
    { username: "u" },
    { username: "u", password: "p", extra: "x" },
    { username: "u", password: "p", [Symbol("s")]: "x" },
    { username: "u".repeat(MAX_FIELD_CHARS + 1), password: "p" },
    { username: "u", password: "p".repeat(MAX_FIELD_CHARS + 1) },
    { username: "u", password: "p".repeat(100_000) },
    { username: "", password: "p" },
    { username: "u", password: 5 },
    { username: "u", password: { toString: () => "p" } },
    { username: "u", pass: "p" },
    Object.create({ username: "u", password: "p" }),
    new (class { username = "u"; password = "p"; })(),
    getter,
  ];
  for (const b of bad) assert.equal(parseCredentials(b, FIELDS), null, String(JSON.stringify(b))?.slice(0, 60));
});

test("a source that declares no fields accepts nothing", () => {
  assert.equal(parseCredentials({}, []), null);
  assert.equal(parseCredentials({ username: "u" }, []), null);
});
