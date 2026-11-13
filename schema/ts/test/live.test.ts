// The live contract (schema/live/v1, ADR 0005 section 4): every example gets its verdict from the
// JSON Schema under Ajv (the validator the player and the phone page use), the action set is
// pinned, and typed literals check the generated TypeScript types (npm run typecheck).
// Example files write a token's secret as `<secret43>`; it is built here at run time.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Ack } from "../../generated/ts/live-ack.d.ts";
import type { Command } from "../../generated/ts/live-command.d.ts";
import type { ForwardedCommand } from "../../generated/ts/live-command-forwarded.d.ts";
import type { CompanionState } from "../../generated/ts/live-companion-state.d.ts";
import type { Hello } from "../../generated/ts/live-hello.d.ts";
import { problems } from "./live-shape.ts";

const V1 = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "live", "v1");
const SECRET = "Ab3-_xY9".repeat(6).slice(0, 43);
const ACTIONS = ["start", "pause", "resume", "skip", "nudge", "undo_resync"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (path: string): any => JSON.parse(readFileSync(path, "utf8").replaceAll("<secret43>", SECRET));
const jsonFiles = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
const NAMES = readdirSync(V1)
  .filter((n) => n.endsWith(".schema.json"))
  .map((n) => n.slice(0, -".schema.json".length))
  .sort();

function validator(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(load(join(V1, `${name}.schema.json`)));
}

test("the live contract has 21 schemas", () => {
  assert.equal(NAMES.length, 21);
});

for (const name of NAMES) {
  const validate = validator(name);
  for (const kind of ["valid", "invalid"]) {
    const dir = join(V1, "examples", name, kind);
    test(`${name} has a ${kind} example`, () => {
      assert.ok(jsonFiles(dir).length > 0);
    });
    for (const file of jsonFiles(dir)) {
      test(`${kind} ${name} example: ${file}`, () => {
        assert.equal(validate(load(join(dir, file))), kind === "valid");
      });
    }
  }
}

for (const name of NAMES) {
  test(`${name} is closed (the allowlist of live-shape.ts)`, () => {
    assert.deepEqual(problems(load(join(V1, `${name}.schema.json`))), []);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OPENINGS: [string, (d: any) => void][] = [
  // The reviewer's mutations A to C of PR #176.
  ["A: a property that accepts anything", (d) => (d.properties.meta = {})],
  ["B: patternProperties", (d) => (d.patternProperties = { "^x": {} })],
  ["C: an object subschema without a type", (d) => (d.properties.extra = { properties: { x: {} } })],
  ["a boolean property schema", (d) => (d.properties.extra = true)],
  ["a described-only property", (d) => (d.properties.extra = { title: "x" })],
  ["unevaluatedProperties", (d) => (d.unevaluatedProperties = false)],
  ["dependentSchemas", (d) => (d.dependentSchemas = { v: {} })],
  ["prefixItems", (d) => (d.properties.extra = { type: "array", maxItems: 1, prefixItems: [{}], items: { type: "null" } })],
  ["additionalProperties true", (d) => (d.additionalProperties = true)],
  ["additionalProperties a schema", (d) => (d.additionalProperties = {})],
  ["an object without additionalProperties", (d) => delete d.additionalProperties],
  ["a nested open object", (d) => (d.properties.extra = { type: "object", properties: { x: { type: "string" } } })],
  ["an untyped anyOf branch", (d) => (d.properties.extra = { anyOf: [{ type: "null" }, {}] })],
  ["allOf", (d) => (d.allOf = [{ type: "object", additionalProperties: false, properties: {} }])],
  ["oneOf", (d) => (d.properties.extra = { oneOf: [{ type: "null" }] })],
  ["a type outside the set", (d) => (d.properties.extra = { type: "number" })],
  ["an array without items", (d) => (d.properties.extra = { type: "array", maxItems: 1 })],
  ["an array of anything", (d) => (d.properties.extra = { type: "array", maxItems: 1, items: {} })],
  ["a remote $ref", (d) => (d.properties.extra = { $ref: "other.schema.json" })],
  ["patternProperties inside a condition", (d) => (d.if = { patternProperties: { "^x": {} } })],
  ["a boolean condition", (d) => (d.not = false)],
  ["a string without maxLength", (d) => (d.properties.extra = { type: "string" })],
  ["a pattern-only string without maxLength", (d) => (d.properties.extra = { type: "string", pattern: "^a+$" })],
];
for (const [label, mutate] of OPENINGS) {
  test(`the closed-shape check refuses ${label}`, () => {
    const doc = load(join(V1, "ack.schema.json"));
    assert.deepEqual(problems(doc), []);
    mutate(doc);
    assert.notDeepEqual(problems(doc), []);
  });
}

// The labels, in order, pinned in schema/python/tests/test_live_guards.py too: a check dropped
// from one suite fails there.
const OPENING_LABELS = [
  "A: a property that accepts anything",
  "B: patternProperties",
  "C: an object subschema without a type",
  "a boolean property schema",
  "a described-only property",
  "unevaluatedProperties",
  "dependentSchemas",
  "prefixItems",
  "additionalProperties true",
  "additionalProperties a schema",
  "an object without additionalProperties",
  "a nested open object",
  "an untyped anyOf branch",
  "allOf",
  "oneOf",
  "a type outside the set",
  "an array without items",
  "an array of anything",
  "a remote $ref",
  "patternProperties inside a condition",
  "a boolean condition",
  "a string without maxLength",
  "a pattern-only string without maxLength",
];

test("the closed-shape check covers the same 23 openings as the Python suite", () => {
  assert.equal(OPENINGS.length, 23);
  assert.deepEqual(
    OPENINGS.map(([label]) => label),
    OPENING_LABELS,
  );
});

// The length every match of a live pattern has. The patterns use only anchors, literals, classes
// like [A-Za-z0-9_-], {n} counts and (a|b) groups whose branches are as long as each other;
// anything else throws, so a new construct has to be taught here on purpose.
function fixedWidth(pattern: string): number {
  let i = 0;
  const atom = (): number => {
    const c = pattern[i];
    if (c === "[") {
      i = pattern.indexOf("]", i) + 1;
      return 1;
    }
    if (c === "(") {
      i += 1;
      const widths = [sequence()];
      while (pattern[i] === "|") {
        i += 1;
        widths.push(sequence());
      }
      assert.equal(pattern[i], ")", pattern);
      i += 1;
      assert.equal(new Set(widths).size, 1, `a group of unequal branches in ${pattern}`);
      return widths[0];
    }
    assert.match(c, /[A-Za-z0-9_\-]/, `unsupported pattern construct ${c} in ${pattern}`);
    i += 1;
    return 1;
  };
  const sequence = (): number => {
    let width = 0;
    while (i < pattern.length && pattern[i] !== "|" && pattern[i] !== ")") {
      if (pattern[i] === "^" || pattern[i] === "$") {
        i += 1;
        continue;
      }
      const one = atom();
      const count = /^\{(\d+)\}/.exec(pattern.slice(i));
      if (count) i += count[0].length;
      width += one * (count ? Number(count[1]) : 1);
    }
    return width;
  };
  const width = sequence();
  assert.equal(i, pattern.length, pattern);
  return width;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function* patterned(node: any, where = ""): Generator<[string, any]> {
  if (Array.isArray(node)) {
    for (const [k, v] of node.entries()) yield* patterned(v, `${where}/${k}`);
  } else if (node !== null && typeof node === "object") {
    if (typeof node.pattern === "string") yield [where, node];
    for (const [k, v] of Object.entries(node)) yield* patterned(v, `${where}/${k}`);
  }
}

test("maxLength equals the length a fixed-length pattern gives", () => {
  let checked = 0;
  for (const name of NAMES) {
    for (const [where, node] of patterned(load(join(V1, `${name}.schema.json`)))) {
      assert.equal(node.maxLength, fixedWidth(node.pattern), `${name} ${where}`);
      checked += 1;
    }
  }
  // The Python suite pins the same count.
  assert.equal(checked, 16);
});

test("fixedWidth reads the live pattern forms", () => {
  assert.equal(fixedWidth("^[A-Za-z0-9_-]{22}$"), 22);
  assert.equal(fixedWidth("^cbp_(hst|ctl|rdr)_[A-Za-z0-9_-]{43}$"), 51);
  assert.equal(fixedWidth("^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$"), 9);
});

// The error set of each route, pinned in full (schema/python/tests/test_live_guards.py too).
const ROUTE_ERRORS: Record<string, string[]> = {
  "POST /api/live/sessions": [
    "body_too_large",
    "invalid_token",
    "token_unknown",
    "token_expired",
    "token_revoked",
    "sessions_full",
    "too_many_requests",
    "internal_error",
  ],
  "POST /api/live/controller": ["invalid_request", "body_too_large", "cannot_control", "internal_error"],
  "POST /api/live/control": ["invalid_request", "body_too_large", "invalid_code", "controllers_full", "too_many_requests", "internal_error"],
};

test("each route's error set in routing.json is pinned, and is inside the error enum", () => {
  const routing = load(join(V1, "routing.json"));
  const codes: string[] = load(join(V1, "error.schema.json")).properties.error.enum;
  const byRoute: Record<string, string[]> = {};
  for (const r of routing.http) byRoute[r.route] = [...r.errors].sort();
  assert.deepEqual(
    byRoute,
    Object.fromEntries(Object.entries(ROUTE_ERRORS).map(([k, v]) => [k, [...v].sort()])),
  );
  for (const errors of Object.values(byRoute)) for (const e of errors) assert.ok(codes.includes(e), e);
});

test("the command actions are exactly the ADR 0005 table, nudge exactly ±5000 ms", () => {
  for (const name of ["command", "command-forwarded"]) {
    const props = load(join(V1, `${name}.schema.json`)).properties;
    assert.deepEqual(props.action.enum, ACTIONS);
    assert.deepEqual(props.deltaMs.enum, [5000, -5000]);
  }
  assert.deepEqual(load(join(V1, "companion-state.schema.json")).properties.allowed.items.enum, ACTIONS);
  assert.equal("slot" in load(join(V1, "command.schema.json")).properties, false);
});

test("literals of the generated types are valid messages", () => {
  const run = "Q2xhc3NSdW4tMDAwMDAwMQ";
  const id = "dGFwLTAwMDAwMDAwMDAwMQ";
  const hello: Hello = { v: 1, type: "hello", token: `cbp_ctl_${SECRET}` };
  const command: Command = { v: 1, type: "command", id, run, basis: 7, action: "nudge", deltaMs: -5000 };
  const forwarded: ForwardedCommand = { ...command, slot: 2 };
  const ack: Ack = { v: 1, type: "ack", id, result: "refused", reason: "would_stop_following" };
  const state: CompanionState = {
    v: 1,
    type: "companion_state",
    run,
    seq: 7,
    status: "paused",
    classMs: 1000,
    lengthMs: 60000,
    classRemainingMs: 59000,
    now: { index: 0, zone: { number: 1, name: "Easy" }, cue: "", remainingMs: 59000 },
    next: [],
    nextSong: null,
    link: { mode: "manual", state: "manual", canUndo: false, announcement: null },
    allowed: ["resume", "nudge"],
  };
  // @ts-expect-error The phone's command has no slot: the server stamps it.
  const withSlot: Command = { ...command, slot: 1 };
  // @ts-expect-error No action outside the ADR 0005 table.
  const previous: Command = { ...command, action: "previous" };
  // @ts-expect-error nudge moves exactly ±5000 ms.
  const far: Command = { ...command, deltaMs: 10000 };
  assert.equal(validator("hello")(hello), true);
  assert.equal(validator("command")(command), true);
  assert.equal(validator("command-forwarded")(forwarded), true);
  assert.equal(validator("ack")(ack), true);
  assert.equal(validator("companion-state")(state), true);
  assert.equal(validator("command")(withSlot), false);
  assert.equal(validator("command")(previous), false);
  assert.equal(validator("command")(far), false);
});
