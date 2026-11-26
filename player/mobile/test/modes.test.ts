// The modes' start pages (issue #630): the words follow docs/design/app-modes.md, native answers are
// read strictly, and each mode's page reaches only its own mode's plugin.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
  assert.doesNotMatch(source("main.ts"), /modes\/|instructorMode|riderMode/);
});

test("the room page reaches native code only through getClass and the follow intents, never instructor mode's whole plugin", () => {
  const main = source("main.ts");
  assert.match(main, /^import \{ roomClass, roomFollow \} from "\.\/room\/native\.ts";$/m);
  assert.match(main, /^ {2}native: roomClass\(\),$/m);
  assert.match(main, /^ {2}follower: \(\) => phoneFollower\(roomFollow\(\), window, \{ now, every \}\),$/m);
  const native = source("room/native.ts");
  assert.equal([...native.matchAll(/instructorMode\(\)/g)].length, 2);
  assert.match(native, /^export const roomClass = \(\): RoomClassSource => roomClassSource\(instructorMode\(\)\);$/m);
  assert.match(native, /^export const roomFollow = \(\): RoomFollowSource => roomFollowSource\(instructorMode\(\)\);$/m);
  // The narrowing: a frozen object with getClass alone, passing on the id and nothing else.
  const narrow = source("room/class-source.ts");
  assert.match(narrow, /^ {2}return Object\.freeze\(\{ getClass: \(args: \{ id: string \}\) => plugin\.getClass\(\{ id: args\.id \}\) \}\);$/m);
  // class-source.ts takes the plugin's type only, never the plugin.
  assert.doesNotMatch(narrow, /instructorMode\(|riderMode|registerPlugin|^import \{/m);
  // The follow narrowing (issue #872): a frozen object with the eight follow intents alone, each
  // called with no argument, so nothing of the page goes native; the plugin's type only.
  const follow = source("room/follow-source.ts");
  const calls = [...follow.matchAll(/^ {4}(\w+): \(\) => plugin\.(\w+)\(\),$/gm)].map((m) => [m[1], m[2]]);
  const eight = ["followAccess", "openFollowSetting", "follow", "unfollow", "reading", "sendPlay", "sendPause", "sendNext"];
  assert.deepEqual(calls, eight.map((n) => [n, n]));
  assert.match(follow, /^ {2}return Object\.freeze\(\{$/m);
  assert.equal([...follow.matchAll(/plugin\./g)].length, eight.length);
  assert.doesNotMatch(follow, /instructorMode\(|riderMode|registerPlugin|^import \{/m);
  for (const name of readdirSync(join(SRC, "room")).filter((n) => n.endsWith(".ts") && n !== "native.ts" && n !== "class-source.ts" && n !== "follow-source.ts")) {
    assert.doesNotMatch(source(join("room", name)), /instructorMode|riderMode|@capacitor\/core|registerPlugin|Capacitor\./, name);
  }
});

test("rider mode never shows Follow and never reaches a follow intent (issue #872)", () => {
  const FOLLOW_INTENT = /\b(followAccess|openFollowSetting|unfollow|sendPlay|sendPause|sendNext)\b|\b(reading|follow)\(/;
  const riderFiles = ["rider.ts", ...readdirSync(join(SRC, "rider")).filter((n) => n.endsWith(".ts")).map((n) => join("rider", n))];
  for (const name of riderFiles) {
    const text = source(name);
    assert.doesNotMatch(text, FOLLOW_INTENT, name);
    // Not the app's room page, the follower or its sheet (src/room/, src/follow/): no way to the key
    // from rider mode. The web's shared DOM helpers (web/src/room/dom.ts) are not the room page.
    assert.doesNotMatch(text, /["']\.\.?\/(room|follow)\/|follow-(ask|sheet|source|band)|phoneFollower|followKey/, name);
    assert.doesNotMatch(text, /"Follow"|>Follow</, name);
  }
  // Rider mode's plugin has no follow intent: native code would refuse one, and the page has none.
  const bridge = source("modes/bridge.ts");
  const rider = /export interface RiderModePlugin \{([\s\S]*?)\n\}/.exec(bridge)?.[1] ?? "";
  assert.match(rider, /join\(/, "the rider plugin's block was found");
  assert.doesNotMatch(rider, FOLLOW_INTENT);
});

test("the bridge names exactly the native intents, and only join and getClass take arguments: the code and nickname, the class id", () => {
  const bridge = source("modes/bridge.ts");
  const plugins = [...bridge.matchAll(/registerPlugin<\w+>\("(\w+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(plugins, ["RiderMode", "InstructorMode"]);
  // The intents of IntentPolicy.kt with their parameters: no address, token or number goes native.
  const intents = [...bridge.matchAll(/^\s+(\w+)\(([^)]*)\): Promise<unknown>;$/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(intents, [
    ["instructorWay", ""],
    ["askInstructorMode", ""],
    ["join", "args: { session: string; nickname: string }"],
    ["open", ""],
    ["receive", ""],
    ["leave", ""],
    ["askRiderMode", ""],
    ["listClasses", ""],
    // The room page's one intent (issue #871), narrowed to it by room/class-source.ts.
    ["getClass", "args: { id: string }"],
    ["syncNow", ""],
    ["unpair", ""],
    ["pairAgain", ""],
    ["followAccess", ""],
    ["openFollowSetting", ""],
    ["follow", ""],
    ["unfollow", ""],
    ["reading", ""],
    ["sendPlay", ""],
    ["sendPause", ""],
    ["sendNext", ""],
  ]);
});
