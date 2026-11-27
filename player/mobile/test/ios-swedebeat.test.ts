// The iOS app with Swedebeat off (issue #932; docs/design/swedebeat.md, "The iOS app"). The one build
// setting is off; with it off no Swedebeat path is reachable on iOS (native code holds none, the page
// shows one dimmed state and never opens a class from Swedebeat); a guard fails if the build turns
// Swedebeat on without the setting changing; turning the setting on restores today's behaviour.
// Fakes only: no network, no device.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildOptions, swedebeatEnabled } from "../build-config.mjs";
import { parseClassList } from "../src/modes/classes.ts";
import { NOT_AVAILABLE, refused, swedebeatFacts, swedebeatOff } from "../src/swedebeat-off.ts";
import { openRoom } from "../src/room/open-room.ts";
import { listAfter, PLATE_WORDS, plateFor } from "../src/room/plate-words.ts";
import { objcFiles, swiftFiles } from "./ios-sources.ts";
import { classDoc, harness, ID } from "./room-fakes.ts";

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTING_FILE = "ios/App/App/Policy/SwedebeatSetting.swift";
const swiftOf = (path: string): string => readFileSync(join(MOBILE, path), "utf8");
const swedebeatDoc = (): Record<string, unknown> => JSON.parse(readFileSync(join(MOBILE, "..", "..", "schema", "class-format", "v1", "examples", "valid", "class-swedebeat-mix.json"), "utf8"));

/** Where the iOS build could turn Swedebeat on besides the setting: any file of the project that names it. */
const PROJECT_FILES = ["ios/App/App.xcodeproj/project.pbxproj", "ios/App/App/Info.plist", "ios/App/App/Info-Debug.plist", "ios/App/Podfile", "ios/App/App/capacitor.config.json"];
/** The files that may name Swedebeat: the setting's own file, the project that lists that file and the test that reads it. */
const NAMES_IT = new Set([SETTING_FILE, "ios/App/App.xcodeproj/project.pbxproj", "ios/App/AppTests/ShellTests.swift"]);

/** Files that name Swedebeat other than the allowed ones, and a setting that is not a plain `false`. */
export function swedebeatGaps(files: ReadonlyArray<{ path: string; text: string }>): string[] {
  const gaps = files.filter((f) => !NAMES_IT.has(f.path) && /swedebeat/i.test(f.text)).map((f) => `${f.path} names Swedebeat`);
  const setting = files.find((f) => f.path === SETTING_FILE);
  if (setting === undefined || !/^\s*static let swedebeatEnabled = false\s*$/m.test(setting.text)) gaps.push("swedebeatEnabled is not off");
  return gaps;
}

const shipped = [...swiftFiles, ...objcFiles, ...PROJECT_FILES.map((path) => ({ path, text: swiftOf(path) }))];

test("criterion 1: the iOS setting is off, and no iOS source or project file reaches Swedebeat", () => {
  assert.deepEqual(swedebeatGaps(shipped), []);
  assert.equal(swedebeatEnabled(), false);
});

test("criterion 1, guard: the build fails the guard if Swedebeat is turned on without the setting changing", () => {
  // The setting turned on: the guard names it.
  const on = shipped.map((f) => (f.path === SETTING_FILE ? { ...f, text: f.text.replace("swedebeatEnabled = false", "swedebeatEnabled = true") } : f));
  assert.deepEqual(swedebeatGaps(on), ["swedebeatEnabled is not off"]);
  // A native source that signs in to or fetches from Swedebeat while the setting stays off.
  const planted = [...shipped, { path: "ios/App/App/SwedebeatSignIn.swift", text: "final class SwedebeatSignIn {}" }];
  assert.deepEqual(swedebeatGaps(planted), ["ios/App/App/SwedebeatSignIn.swift names Swedebeat"]);
  // A project file that names it (a key, a host, a permitted domain).
  const plist = shipped.map((f) => (f.path.endsWith("Info.plist") ? { ...f, text: `${f.text}<key>SwedebeatHost</key>` } : f));
  assert.ok(swedebeatGaps(plist).length > 0);
  // The page's copy follows the one line, and anything but true or false stops the build.
  assert.equal(swedebeatEnabled("static let swedebeatEnabled = true"), true);
  assert.throws(() => swedebeatEnabled("static let swedebeatEnabled = maybe"));
});

test("criterion 1: the shipped page bundles are built with the setting off", async () => {
  const r = await build({ ...buildOptions("unused"), absWorkingDir: MOBILE, write: false, logLevel: "silent" });
  const out = r.outputFiles.map((f) => f.text).join("\n");
  assert.ok(!out.includes("__SWEDEBEAT_ENABLED__"));
  const on = await build({ ...buildOptions("unused"), define: { __SWEDEBEAT_ENABLED__: "true" }, absWorkingDir: MOBILE, write: false, logLevel: "silent" });
  assert.notEqual(on.outputFiles.map((f) => f.text).join("\n"), out);
});

test("the dimmed states are the iOS app's with the setting off, and nothing else's", () => {
  assert.equal(swedebeatOff("ios", false), true);
  for (const platform of ["android", "web"]) assert.equal(swedebeatOff(platform, false), false);
  assert.equal(refused(true, "swedebeat"), true);
  for (const source of ["spotify", "local", "none", undefined]) assert.equal(refused(true, source), false);
});

test("criterion 3: turning the setting on restores today's behaviour", async () => {
  assert.equal(swedebeatOff("ios", true), false);
  assert.equal(refused(swedebeatOff("ios", true), "swedebeat"), false);
  const h = harness(() => Promise.resolve({ document: swedebeatDoc() }), `?id=${ID}`);
  assert.equal(await openRoom({ ...h.deps, swedebeatOff: swedebeatOff("ios", true) }), "open");
  assert.deepEqual(h.went, []);
  assert.equal(h.installed.length, 1);
});

test("with the setting off a class from Swedebeat never opens: no room, back to the list with the one sentence", async () => {
  const h = harness(() => Promise.resolve({ document: swedebeatDoc() }), `?id=${ID}`);
  assert.equal(await openRoom({ ...h.deps, swedebeatOff: true }), "swedebeat");
  assert.equal(h.installed.length, 0);
  assert.equal(h.mounted, 0);
  assert.deepEqual(h.went, [listAfter("swedebeat")]);
  assert.deepEqual(plateFor(new URL(h.went[0], "https://localhost/").hash), { head: NOT_AVAILABLE, detail: "" });
  // Spotify and local-file classes are unaffected.
  const other = harness(() => Promise.resolve({ document: classDoc() }), `?id=${ID}`);
  assert.equal(await openRoom({ ...other.deps, swedebeatOff: true }), "open");
});

test("the list answer may name a class's source, and any unknown source is refused whole", () => {
  const row = { id: ID, title: "Mix class", minutes: 30, songs: 12 };
  const list = parseClassList({ classes: [{ ...row, source: "swedebeat" }, row], status: "synced" });
  assert.deepEqual(list?.classes.map((c) => c.source), ["swedebeat", undefined]);
  assert.equal(list?.classes[0].songs, 12);
  assert.equal(parseClassList({ classes: [{ ...row, source: "napster" }], status: "synced" }), null);
  assert.equal(swedebeatFacts(12), "Swedebeat, 12 songs");
  assert.equal(swedebeatFacts(1), "Swedebeat, 1 song");
});

test("W13: the sentence is the only reason text, verbatim, in the page's words", () => {
  assert.equal(NOT_AVAILABLE, "Not available in this app yet");
  assert.equal(PLATE_WORDS.swedebeat.head, NOT_AVAILABLE);
  for (const file of ["src/swedebeat-off.ts", "src/modes/swedebeat-view.ts"]) {
    const text = swiftOf(file).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const words = [...text.matchAll(/(["`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]).filter((s) => /\s/.test(s) && !/[{}$]/.test(s));
    for (const w of words) assert.ok(!/\b(off|disabled|blocked|coming soon|review|apple|store|policy|legal|licen[cs]e)\b/i.test(w), w);
  }
  const view = swiftOf("src/modes/swedebeat-view.ts");
  assert.match(view, /aria-disabled/);
  assert.doesNotMatch(view, /\.disabled\s*=|"disabled"/);
});
