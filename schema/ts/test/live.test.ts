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
