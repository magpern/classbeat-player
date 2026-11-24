// The modes' start pages (issue #630): the words follow docs/design/app-modes.md, native answers are
// read strictly, and each mode's page reaches only its own mode's plugin.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { INSTRUCTOR, parseAnswer, parseWay, RIDER } from "../src/modes/words.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const source = (name: string): string => readFileSync(join(SRC, name), "utf8");

test("the strip names the other mode, with the lead line for each way in", () => {
  assert.equal(RIDER.key, "Switch to instructor mode");
  assert.equal(INSTRUCTOR.key, "Switch to rider mode");
  assert.equal(RIDER.lead.pair, "Teaching? Switch to pair this phone with your account.");
  assert.equal(RIDER.lead.lock, "Teaching? Your screen lock opens instructor mode.");
  assert.deepEqual([RIDER.tag, INSTRUCTOR.tag], ["Rider mode", "Instructor mode"]);
});

test("instructorWay's answer is read strictly; anything else is the way that opens nothing", () => {
  assert.equal(parseWay({ way: "lock" }), "lock");
  assert.equal(parseWay({ way: "pair" }), "pair");
  for (const bad of [undefined, null, "lock", ["lock"], {}, { way: "LOCK" }, { way: "lock", extra: 1 }, { result: "lock" }, { way: true }]) {
    assert.equal(parseWay(bad), "pair", JSON.stringify(bad));
  }
});

test("a question's answer is read strictly; anything else is 'stayed'", () => {
  for (const a of ["stayed", "notConfirmed", "unpaired"] as const) assert.equal(parseAnswer({ result: a }), a);
  for (const bad of [undefined, null, "notConfirmed", {}, { result: "opened" }, { result: "notconfirmed" }, { result: "notConfirmed", x: 1 }, { way: "notConfirmed" }]) {
    assert.equal(parseAnswer(bad), "stayed", JSON.stringify(bad));
  }
});

test("each mode's page reaches only its own mode's plugin, and only through bridge.ts", () => {
  const rider = source("rider.ts");
  const instructor = source("instructor.ts");
  assert.match(rider, /\briderMode\(\)/);
  assert.doesNotMatch(rider, /\binstructorMode\b|askRiderMode|"InstructorMode"/);
  assert.match(instructor, /\binstructorMode\(\)/);
  assert.doesNotMatch(instructor, /\briderMode\b|askInstructorMode|instructorWay|"RiderMode"/);
  for (const [name, text] of [["rider.ts", rider], ["instructor.ts", instructor], ["main.ts", source("main.ts")]]) {
    assert.doesNotMatch(text, /@capacitor\/core|registerPlugin|Capacitor\./, name);
  }
  // The room screen's page has no mode plugin and no strip: no switch with a class open.
  assert.doesNotMatch(source("main.ts"), /modes\//);
});

test("the bridge names exactly the native intents, none taking an argument", () => {
  const bridge = source("modes/bridge.ts");
  const plugins = [...bridge.matchAll(/registerPlugin<\w+>\("(\w+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(plugins, ["RiderMode", "InstructorMode"]);
  // The intents of IntentPolicy.kt, each declared with an empty parameter list.
  const intents = [...bridge.matchAll(/^\s+(\w+)\((\w*)\): Promise<unknown>;$/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(intents, [
    ["instructorWay", ""],
    ["askInstructorMode", ""],
    ["askRiderMode", ""],
    ["listClasses", ""],
    ["syncNow", ""],
    ["unpair", ""],
    ["pairAgain", ""],
  ]);
});
