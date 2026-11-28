// The macOS check of the built iOS app, ios:verify (issue #894, criterion 5), run here on fakes:
// Apple's plutil is replaced by the Linux readers, so the same steps and the same allowlists are
// exercised. That plutil and codesign read the real build as expected is shown by the macOS job.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEBUG_ATS, type Json, scenes } from "../ios-verify/allowlists.ts";
import { plistXml } from "../ios-verify/plist-xml.ts";
import { selfTest, type Tools, verifyBuild } from "../ios-verify/verify.ts";
import { IOS } from "./ios-sources.ts";
import { readPbxproj } from "./pbxproj.ts";
import { readPlist } from "./plist.ts";

const MOBILE = join(IOS, "..");
const PROJECT = join(IOS, "App", "App.xcodeproj", "project.pbxproj");
const read = (path: string): Json => (path.endsWith(".pbxproj") ? readPbxproj(readFileSync(path, "utf8")) : readPlist(readFileSync(path, "utf8"))) as Json;
const unsigned: Tools = { plistJson: read, signedEntitlements: () => undefined };

/** The committed debug plist as Xcode builds it: the module named, the toolchain keys added. */
const builtDebug = (): Json => {
  const plist = readPlist(readFileSync(join(IOS, "App", "App", "Info-Debug.plist"), "utf8")) as { [key: string]: Json };
  return { ...plist, UIApplicationSceneManifest: scenes("App"), DTXcode: "1640", MinimumOSVersion: "16.0" };
};

/** A derived-data folder holding one app built for each product directory named. */
function derived(products: { [dir: string]: Json }, xcent?: Json): string {
  const root = mkdtempSync(join(tmpdir(), "ios-verify-test-"));
  for (const [dir, plist] of Object.entries(products)) {
    const app = join(root, "Build", "Products", dir, "App.app");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, "Info.plist"), plistXml(plist));
  }
  if (xcent !== undefined) {
    const at = join(root, "Build", "Intermediates.noindex", "App.build", "Debug-iphonesimulator", "App.build");
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, "App.app-Simulated.xcent"), plistXml(xcent));
  }
  return root;
}

const verify = (products: { [dir: string]: Json }, tools = unsigned, xcent?: Json): string[] => {
  const root = derived(products, xcent);
  try {
    return verifyBuild(root, PROJECT, tools);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("the self-test passes on the committed project and fails when a reader sees nothing", () => {
  assert.deepEqual(selfTest(PROJECT, unsigned), []);
  // A reader that always gives the committed project: every planted file then reads clean.
  const blind: Tools = { plistJson: () => read(PROJECT), signedEntitlements: () => undefined };
  assert.ok(selfTest(PROJECT, blind).some((f) => f.startsWith("a camera key through settings: no finding")));
});

test("a clean debug build and the project give no finding", () => {
  assert.deepEqual(verify({ "Debug-iphonesimulator": builtDebug() }), []);
  const identity = { "application-identifier": "T.x", "keychain-access-groups": ["T.x"], "get-task-allow": true };
  assert.deepEqual(verify({ "Debug-iphonesimulator": builtDebug() }, unsigned, identity), []);
  assert.deepEqual(verify({ "Debug-iphonesimulator": builtDebug() }, { plistJson: read, signedEntitlements: () => ({}) }), []);
});

test("each planted build gives a finding", () => {
  const debug = builtDebug() as { [key: string]: Json };
  const release = { ...debug };
  delete release["NSAppTransportSecurity"];
  const cases: [string, string[], string][] = [
    ["no app", verify({}), "0 built apps"],
    ["two apps", verify({ "Debug-iphonesimulator": debug, "Release-iphoneos": release }), "2 built apps"],
    ["a camera key", verify({ "Debug-iphonesimulator": { ...debug, NSCameraUsageDescription: "x" } }), "NSCameraUsageDescription"],
    ["the source scene name", verify({ "Debug-iphonesimulator": { ...debug, UIApplicationSceneManifest: scenes() } }), "scene manifest"],
    ["a fourth font name", verify({ "Debug-iphonesimulator": { ...debug, UIAppFonts: [...(debug["UIAppFonts"] as string[]), "extra.ttf"] } }), "UIAppFonts"],
    ["one font name dropped", verify({ "Debug-iphonesimulator": { ...debug, UIAppFonts: (debug["UIAppFonts"] as string[]).slice(1) } }), "UIAppFonts"],
    ["no fonts listed", verify({ "Debug-iphonesimulator": Object.fromEntries(Object.entries(debug).filter(([k]) => k !== "UIAppFonts")) }), "UIAppFonts"],
    ["loads in a release build", verify({ "Release-iphoneos": { ...release, NSAppTransportSecurity: DEBUG_ATS } }), "NSAppTransportSecurity is set"],
    ["a capability prepared for signing", verify({ "Debug-iphonesimulator": debug }, unsigned, { "com.apple.developer.healthkit": true }), "healthkit is not allowed"],
    ["a debugger signed into a release build", verify({ "Release-iphoneos": release }, { plistJson: read, signedEntitlements: () => ({ "get-task-allow": true }) }), "get-task-allow"],
  ];
  assert.deepEqual(cases.filter(([, f, expect]) => !f.some((l) => l.includes(expect))).map(([name]) => name), []);
});

test("ios:verify refuses to run outside macOS", () => {
  if (process.platform === "darwin") return;
  const r = spawnSync(process.execPath, ["--import", "tsx", "ios-verify/main.ts"], { cwd: MOBILE, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /macOS only/);
});
