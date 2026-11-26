// The check of the built iOS app (issue #894, criterion 5): Apple's own reader (plutil) turns the
// built Info.plist, the built app's entitlements and the Xcode project into JSON, and the shared
// checks hold each to the allowlists. The tools are passed in, so the Linux tests run the same
// steps on fakes; the self-test runs them on planted temp files.
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEBUG_ATS, type Json, scenes } from "./allowlists.ts";
import { entitlementFindings, plistFindings, projectJsonFindings } from "./checks.ts";
import { plistXml } from "./plist-xml.ts";

export type Tools = {
  /** A property list file (XML, binary or Xcode's old style) as JSON, read by Apple's reader. */
  plistJson(path: string): Json;
  /** The app's signed entitlements as JSON ({} when signed with none), or undefined when unsigned. */
  signedEntitlements(app: string): Json | undefined;
};

const PRODUCTS = /^(Debug|Release)-iphone(os|simulator)$/;

/** Every file under a directory whose name matches. */
function filesUnder(dir: string, name: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return filesUnder(p, name);
    return name.test(n) ? [p] : [];
  });
}

/** What is wrong with the app built under derivedData, and with the project. */
export function verifyBuild(derivedData: string, project: string, tools: Tools): string[] {
  const products = join(derivedData, "Build", "Products");
  let apps: [config: string, app: string][] = [];
  try {
    apps = readdirSync(products)
      .filter((d) => PRODUCTS.test(d))
      .flatMap((d) => readdirSync(join(products, d)).filter((n) => n === "App.app").map((n): [string, string] => [d.split("-")[0]!, join(products, d, n)]));
  } catch {
    // No products directory: the app is missing, reported below.
  }
  if (apps.length !== 1) return [`${apps.length} built apps under ${products}, not one`];
  const [config, app] = apps[0]!;
  const debug = config === "Debug";
  const found = plistFindings("the built Info.plist", tools.plistJson(join(app, "Info.plist")), { debug, built: true });
  const signed = tools.signedEntitlements(app);
  if (signed !== undefined) found.push(...entitlementFindings("the signed app", signed, debug));
  else {
    // An unsigned build: the entitlements Xcode would have signed it with are its .xcent files.
    const intermediates = join(derivedData, "Build", "Intermediates.noindex");
    let xcents: string[] = [];
    try {
      xcents = filesUnder(intermediates, /\.xcent$/);
    } catch {
      // No intermediates: nothing was prepared for signing.
    }
    for (const f of xcents) found.push(...entitlementFindings(f, tools.plistJson(f), debug));
  }
  found.push(...projectJsonFindings(tools.plistJson(project)).map((f) => `the project: ${f}`));
  return found;
}

const BUILT: Json = { CFBundleIdentifier: "x", DTXcode: "1640", UIApplicationSceneManifest: scenes("App"), NSAppTransportSecurity: DEBUG_ATS };
const omit = (v: Json, key: string): Json => Object.fromEntries(Object.entries(v as object).filter(([k]) => k !== key)) as Json;
const add = (v: Json, extra: { [key: string]: Json }): Json => ({ ...(v as object), ...extra }) as Json;
const ID = "AA0000000000000000000099";
const plantSetting = (pbxproj: string, line: string): string => pbxproj.replace("\t\t\t\tINFOPLIST_FILE = App/Info.plist;\n", `$&\t\t\t\t${line}\n`);

/** Runs every check on planted temp files: each clean file must pass and each planted one must
 * give a finding. Returns what did not happen as it should, one line each. */
export function selfTest(project: string, tools: Tools): string[] {
  const dir = mkdtempSync(join(tmpdir(), "ios-verify-"));
  const failed: string[] = [];
  const expect = (name: string, check: () => string[], clean: boolean): void => {
    let findings: string[];
    try {
      findings = check();
    } catch (e) {
      findings = [`could not be read: ${(e as Error).message}`];
    }
    if (clean !== (findings.length === 0)) failed.push(`${name}: ${clean ? findings.join("; ") : "no finding"}`);
  };
  try {
    const plist = (name: string, v: Json): Json => {
      const p = join(dir, `${name}.plist`);
      writeFileSync(p, plistXml(v));
      return tools.plistJson(p);
    };
    const info: [string, Json, boolean, boolean][] = [
      ["a clean debug plist", BUILT, true, true],
      ["a clean release plist", omit(BUILT, "NSAppTransportSecurity"), false, true],
      ["a camera key", add(BUILT, { NSCameraUsageDescription: "x" }), true, false],
      ["background modes", add(BUILT, { UIBackgroundModes: ["audio"] }), true, false],
      ["a banned key deeper", add(BUILT, { UILaunchScreen: { NSLocationUsageDescription: "x" } }), true, false],
      ["an unlisted key", add(BUILT, { UIStatusBarHidden: true }), true, false],
      ["arbitrary loads", add(BUILT, { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } }), true, false],
      ["loads in release", BUILT, false, false],
    ];
    for (const [name, v, debug, clean] of info) expect(name, () => plistFindings(name, plist(name, v), { debug, built: true }), clean);
    const ents: [string, Json, boolean, boolean][] = [
      ["no entitlements", {}, false, true],
      ["the default identity", { "application-identifier": "T.x", "keychain-access-groups": ["T.x"], "get-task-allow": true }, true, true],
      ["a capability", { "com.apple.developer.networking.networkextension": ["packet-tunnel-provider"] }, true, false],
      ["a debugger in release", { "get-task-allow": true }, false, false],
      ["another keychain group", { "application-identifier": "T.x", "keychain-access-groups": ["T.*"] }, true, false],
    ];
    for (const [name, v, debug, clean] of ents) expect(name, () => entitlementFindings(name, plist(name, v), debug), clean);
    const pbxproj = readFileSync(project, "utf8");
    const projects: [string, string, boolean][] = [
      ["the committed project", pbxproj, true],
      ["a camera key through settings", plantSetting(pbxproj, "INFOPLIST_KEY_NSCameraUsageDescription = x;"), false],
      ["a comment and escapes", plantSetting(pbxproj, 'VALIDATE_PRODUCT = YES//x; "GENERATE_INFO\\U0050LIST_FILE" = YES; "INFO\\U0050LIST_KEY_NSCameraUsageDescription" = x; Z = "\n; //";'), false],
      ["linker flags", plantSetting(pbxproj, 'OTHER_LDFLAGS = "-ObjC";'), false],
      ["entitlements", plantSetting(pbxproj, "CODE_SIGN_ENTITLEMENTS = App/App.entitlements;"), false],
      ["a package", pbxproj.replace("/* Begin PBXBuildFile section */\n", `$&\t\t${ID} = {isa = XCRemoteSwiftPackageReference; };\n`), false],
    ];
    for (const [name, text, clean] of projects) {
      const p = join(dir, `${name}.pbxproj`);
      writeFileSync(p, text);
      expect(name, () => projectJsonFindings(tools.plistJson(p)), clean);
    }
    const empty = join(dir, "no-build");
    mkdirSync(join(empty, "Build", "Products", "Debug-iphonesimulator"), { recursive: true });
    expect("no built app", () => verifyBuild(empty, project, tools), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failed;
}
