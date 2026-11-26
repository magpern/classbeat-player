// The iOS app's project files (issue #894, ADR 0016 sections 2, 3 and 8): the Info.plist and
// entitlement allowlists, the debug-only loopback exception, a release build without DEBUG, the
// Podfile of Capacitor's own pods, the locked Capacitor config and the pages the build copies in.
// Each check is a function of the file's text, shown to fail on a planted example.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { MOBILE, mobileFiles } from "../../app/test/unit/rule-sources.ts";
import { IOS } from "./ios-sources.ts";
import { readPlist, type PlistValue } from "./plist.ts";

const APP = join(IOS, "App");
const text = (...p: string[]): string => readFileSync(join(APP, ...p), "utf8");
type Dict = { [key: string]: PlistValue };
const isDict = (v: PlistValue | undefined): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);

/** The Info.plist keys the app may have. NSFaceIDUsageDescription is for the sign-in to come (ADR 0016). */
const INFO_KEYS = new Set([
  "CFBundleDevelopmentRegion",
  "CFBundleDisplayName",
  "CFBundleExecutable",
  "CFBundleIdentifier",
  "CFBundleInfoDictionaryVersion",
  "CFBundleName",
  "CFBundlePackageType",
  "CFBundleShortVersionString",
  "CFBundleVersion",
  "LSRequiresIPhoneOS",
  "NSFaceIDUsageDescription",
  "UIApplicationSceneManifest",
  "UILaunchScreen",
  "UIRequiredDeviceCapabilities",
  "UISupportedInterfaceOrientations",
  "UISupportedInterfaceOrientations~ipad",
  "UIViewControllerBasedStatusBarAppearance",
]);
/** Keys that are never in the app, at any depth: camera, microphone, photos, location, background
 * modes, Bluetooth, arbitrary loads, other apps' links and the rest of what it does not do. */
const BANNED_KEY =
  /^(NSCamera|NSMicrophone|NSPhotoLibrary|NSLocation|UIBackgroundModes|NSBluetooth|NSAllowsArbitraryLoads|NSAllowsLocalNetworking|NSSpeechRecognition|NSAppleMusic|NSLocalNetwork|NSBonjourServices|NSMotion|NSContacts|NSCalendars|NSReminders|NSHealth|NSUserTracking|NSNearbyInteraction|CFBundleURLTypes|LSApplicationQueriesSchemes|UIFileSharingEnabled|LSSupportsOpeningDocumentsInPlace|CFBundleDocumentTypes|NSUserActivityTypes|BGTaskSchedulerPermittedIdentifiers|com\.apple\.)/;
const SCENES: PlistValue = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      { UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate" },
    ],
  },
};
/** The one difference of the debug plist: plain http to localhost, for a loopback test server. */
const DEBUG_ATS: PlistValue = { NSExceptionDomains: { localhost: { NSExceptionAllowsInsecureHTTPLoads: true } } };

/** Every key in a property list, at any depth, as a path ("a.b[0].c"). */
function keysAt(v: PlistValue, at = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => keysAt(x, `${at}[${i}].`));
  if (!isDict(v)) return [];
  return Object.entries(v).flatMap(([k, x]) => [`${at}${k}`, ...keysAt(x, `${at}${k}.`)]);
}
const lastKey = (path: string): string => path.replace(/^.*\]?\./, "");

/** What is wrong with the release and debug Info.plist, one line each. */
export function infoFindings(releaseXml: string, debugXml: string): string[] {
  const found: string[] = [];
  const release = readPlist(releaseXml);
  const debug = readPlist(debugXml);
  if (!isDict(release) || !isDict(debug)) return ["an Info.plist is not a dictionary"];
  for (const k of Object.keys(release)) if (!INFO_KEYS.has(k)) found.push(`release: ${k} is not on the allowlist`);
  for (const [name, plist] of [["release", release], ["debug", debug]] as const) {
    for (const path of keysAt(plist)) if (BANNED_KEY.test(lastKey(path))) found.push(`${name}: ${path} is banned`);
  }
  if (!isDeepStrictEqual(release["UIApplicationSceneManifest"], SCENES)) found.push("release: the scene manifest is not the one window scene");
  if ("NSAppTransportSecurity" in release) found.push("release: NSAppTransportSecurity is set (HTTPS only means no exception)");
  const { NSAppTransportSecurity: ats, ...rest } = debug;
  if (!isDeepStrictEqual(ats, DEBUG_ATS)) found.push("debug: the transport security is not the localhost exception alone");
  if (!isDeepStrictEqual(rest, release)) found.push("debug: differs from release by more than the localhost exception");
  return found;
}

type BuildConfig = { name: string; settings: string };
export function buildConfigs(pbxproj: string): BuildConfig[] {
  const re = /isa = XCBuildConfiguration;[^{}]*?buildSettings = \{([\s\S]*?)\n\t\t\t\};\s*name = ("?)([^";\n]+)\2;/g;
  return [...pbxproj.matchAll(re)].map((m) => ({ name: m[3]!, settings: m[1]! }));
}
const setting = (c: BuildConfig, key: string): string | undefined =>
  new RegExp(`^\\s*${key} = ("?)([^";\\n]*)\\1;`, "m").exec(c.settings)?.[2];

/** What is wrong with the Xcode project, one line each. */
export function projectFindings(pbxproj: string): string[] {
  const found: string[] = [];
  const configs = buildConfigs(pbxproj);
  const isa = [...pbxproj.matchAll(/isa = XCBuildConfiguration;/g)].length;
  if (configs.length !== isa || isa === 0) found.push("a build configuration could not be read");
  for (const c of configs) {
    const flags = c.settings.replace(/^\s*(DEBUG_INFORMATION_FORMAT|MTL_ENABLE_DEBUG_INFO) = .*$/gm, "");
    if (c.name !== "Debug" && /DEBUG/.test(flags)) found.push(`${c.name}: compiles with DEBUG`);
    const target = setting(c, "IPHONEOS_DEPLOYMENT_TARGET");
    if (target !== undefined && target !== "16.0") found.push(`${c.name}: deployment target ${target}`);
    const info = setting(c, "INFOPLIST_FILE");
    const expected = c.name === "Debug" ? "App/Info-Debug.plist" : "App/Info.plist";
    if (info !== undefined && info !== expected) found.push(`${c.name}: Info.plist is ${info}`);
  }
  if (!configs.some((c) => setting(c, "IPHONEOS_DEPLOYMENT_TARGET") === "16.0")) found.push("no deployment target");
  const infos = configs.filter((c) => setting(c, "INFOPLIST_FILE") !== undefined).map((c) => c.name).sort();
  if (!isDeepStrictEqual(infos, ["Debug", "Release"])) found.push(`the app's Info.plist is set for ${infos.join(", ") || "nothing"}`);
  for (const banned of ["CODE_SIGN_ENTITLEMENTS", "SystemCapabilities", "XCRemoteSwiftPackageReference", "XCLocalSwiftPackageReference", "XCSwiftPackageProductDependency"]) {
    if (pbxproj.includes(banned)) found.push(`the project has ${banned}`);
  }
  return found;
}

/** What is wrong with the shared scheme: an archive (the build that ships) is a release build. */
export function schemeFindings(scheme: string): string[] {
  const actions = new Map([...scheme.matchAll(/<(\w+Action)\b[^>]*?\bbuildConfiguration\s*=\s*"([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
  return ["ArchiveAction", "ProfileAction"].filter((a) => actions.get(a) !== "Release").map((a) => `${a} is not Release`);
}

const CAPACITOR_PATH = "../../node_modules/@capacitor/ios";
/** What is wrong with the Podfile: only Capacitor's own pods, from the pinned package, iOS 16. */
export function podfileFindings(podfile: string): string[] {
  const found: string[] = [];
  const lines = podfile.split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  const pods = lines.filter((l) => /^pod\b/.test(l));
  const expected = ["Capacitor", "CapacitorCordova"].map((n) => `pod '${n}', :path => '${CAPACITOR_PATH}'`);
  if (!isDeepStrictEqual(pods, expected)) found.push(`the pods are ${pods.join("; ")}`);
  if (!lines.includes("platform :ios, '16.0'")) found.push("the platform is not iOS 16.0");
  for (const l of lines) if (/^(source|plugin)\b|:git\b|:http\b|:podspec\b|\bgem\b/.test(l)) found.push(`not allowed: ${l}`);
  return found;
}

/** What is wrong with Podfile.lock: the same two pods at 8.6.0, nothing from a spec repository. */
export function podlockFindings(lock: string): string[] {
  const found: string[] = [];
  const section = /^PODS:\n((?: {2}.*\n)+)/m.exec(lock)?.[1] ?? "";
  const pods = [...section.matchAll(/^ {2}- "?([^\s"(]+) \(([^)]*)\)/gm)].map((m) => `${m[1]} ${m[2]}`);
  if (!isDeepStrictEqual(pods, ["Capacitor 8.6.0", "CapacitorCordova 8.6.0"])) found.push(`the locked pods are ${pods.join(", ")}`);
  if (/^SPEC REPOS:/m.test(lock)) found.push("a pod comes from a spec repository");
  return found;
}

/** The iOS Capacitor config, as shipped: the bundle at capacitor://localhost, nothing else opened. */
const CONFIG = {
  appId: "org.classbeat.player",
  appName: "classbeat",
  webDir: "public",
  loggingBehavior: "debug",
  server: { iosScheme: "capacitor", hostname: "localhost" },
  ios: { allowsLinkPreview: false, limitsNavigationsToAppBoundDomains: false, zoomEnabled: false },
  plugins: { CapacitorCookies: { enabled: false }, CapacitorHttp: { enabled: false } },
  packageClassList: [],
};
export function configFindings(json: string): string[] {
  const config = JSON.parse(json) as { server?: Record<string, unknown> };
  const found: string[] = [];
  for (const key of ["url", "allowNavigation", "cleartext", "errorPath", "appStartPath"]) {
    if (config.server && key in config.server) found.push(`server.${key} is set`);
  }
  if (!isDeepStrictEqual(config, CONFIG)) found.push("the config is not the locked one");
  return found;
}

const RELEASE = text("App", "Info.plist");
const DEBUG = text("App", "Info-Debug.plist");
const PBXPROJ = text("App.xcodeproj", "project.pbxproj");
const SCHEME = text("App.xcodeproj", "xcshareddata", "xcschemes", "App.xcscheme");
const PODFILE = text("Podfile");
const PODLOCK = text("Podfile.lock");
const CONFIG_JSON = text("App", "capacitor.config.json");

test("the committed project files hold every check", () => {
  assert.deepEqual(infoFindings(RELEASE, DEBUG), []);
  assert.deepEqual(projectFindings(PBXPROJ), []);
  assert.deepEqual(schemeFindings(SCHEME), []);
  assert.deepEqual(podfileFindings(PODFILE), []);
  assert.deepEqual(podlockFindings(PODLOCK), []);
  assert.deepEqual(configFindings(CONFIG_JSON), []);
});

test("the Debug configuration compiles with DEBUG, so a debug build is one", () => {
  const debug = buildConfigs(PBXPROJ).filter((c) => c.name === "Debug");
  assert.ok(debug.some((c) => setting(c, "SWIFT_ACTIVE_COMPILATION_CONDITIONS") === "DEBUG"));
});

/** What is wrong with the files under ios/: an entitlements file (no entitlements at all) or a Swift package. */
export const fileFindings = (paths: readonly string[]): string[] =>
  paths.filter((p) => /\.entitlements$|(^|[\\/])Package\.(swift|resolved)$/.test(p)).map((p) => `${p} is not allowed`);

test("there are no entitlements and no Swift packages", () => {
  assert.deepEqual(fileFindings(mobileFiles(IOS, /./).map((p) => relative(MOBILE, p))), []);
});

test("the pinned @capacitor/ios is 8.6.0, and the build copies the pages into the iOS app", () => {
  const pkg = JSON.parse(readFileSync(join(MOBILE, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies["@capacitor/ios"], "8.6.0");
  assert.equal(pkg.dependencies["@capacitor/core"], "8.6.0");
  // The same loop writes pageHtml (src/page.ts, the desktop CSP) into both apps.
  const outs = /for \(const out of (\[[^\]]*\])\)/.exec(readFileSync(join(MOBILE, "build.mjs"), "utf8"))?.[1];
  assert.deepEqual(JSON.parse(outs ?? "null"), ["android/app/src/main/assets/public", "ios/App/App/public"]);
  assert.ok(!existsSync(join(APP, "App", "public")) || existsSync(join(APP, "App", "public", "index.html")));
});

const swap = (t: string, from: string | RegExp, to: string): string => {
  const out = t.replace(from, to);
  if (out === t) throw new Error(`the file does not hold ${from}`);
  return out;
};
const dictEnd = (xml: string, add: string): string => swap(xml, /<\/dict>\s*<\/plist>/, `${add}</dict></plist>`);

test("each project check fails on a planted example", () => {
  const planted: ReadonlyArray<[name: string, findings: () => string[]]> = [
    ["camera", () => infoFindings(dictEnd(RELEASE, "<key>NSCameraUsageDescription</key><string>x</string>"), DEBUG)],
    ["microphone in debug", () => infoFindings(RELEASE, dictEnd(DEBUG, "<key>NSMicrophoneUsageDescription</key><string>x</string>"))],
    ["photo library", () => infoFindings(dictEnd(RELEASE, "<key>NSPhotoLibraryAddUsageDescription</key><string>x</string>"), DEBUG)],
    ["location", () => infoFindings(dictEnd(RELEASE, "<key>NSLocationWhenInUseUsageDescription</key><string>x</string>"), DEBUG)],
    ["background modes", () => infoFindings(dictEnd(RELEASE, "<key>UIBackgroundModes</key><array><string>audio</string></array>"), DEBUG)],
    ["Bluetooth", () => infoFindings(dictEnd(RELEASE, "<key>NSBluetoothAlwaysUsageDescription</key><string>x</string>"), DEBUG)],
    ["URL types", () => infoFindings(dictEnd(RELEASE, "<key>CFBundleURLTypes</key><array/>"), DEBUG)],
    ["an unlisted key", () => infoFindings(dictEnd(RELEASE, "<key>UIStatusBarHidden</key><true/>"), DEBUG)],
    ["arbitrary loads in debug", () => infoFindings(RELEASE, swap(DEBUG, "<key>NSExceptionDomains</key>", "<key>NSAllowsArbitraryLoads</key><true/><key>NSExceptionDomains</key>"))],
    ["a non-loopback exception", () => infoFindings(RELEASE, swap(DEBUG, "<key>localhost</key>", "<key>example.org</key>"))],
    ["loads in release", () => infoFindings(dictEnd(RELEASE, "<key>NSAppTransportSecurity</key><dict/>"), DEBUG)],
    ["debug differs by more", () => infoFindings(RELEASE, swap(DEBUG, "<string>classbeat</string>", "<string>other</string>"))],
    ["multiple scenes", () => infoFindings(swap(RELEASE, /(UIApplicationSupportsMultipleScenes<\/key>\s*)<false\/>/, "$1<true/>"), DEBUG)],
    ["DEBUG in release", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;"))],
    ["-DDEBUG in release", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", 'INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tOTHER_SWIFT_FLAGS = "-DDEBUG";'))],
    ["the debug plist in release", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", 'INFOPLIST_FILE = "App/Info-Debug.plist";'))],
    ["deployment target", () => projectFindings(swap(PBXPROJ, "IPHONEOS_DEPLOYMENT_TARGET = 16.0;", "IPHONEOS_DEPLOYMENT_TARGET = 15.0;"))],
    ["entitlements", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;"))],
    ["an entitlements file", () => fileFindings(["ios/App/App/App.entitlements"])],
    ["a package file", () => fileFindings(["ios/App/Package.resolved"])],
    ["a Swift package", () => projectFindings(`${PBXPROJ}\n/* XCRemoteSwiftPackageReference "x" */`)],
    ["a debug archive", () => schemeFindings(swap(SCHEME, /(<ArchiveAction\s+buildConfiguration = )"Release"/, '$1"Debug"'))],
    ["another pod", () => podfileFindings(swap(PODFILE, "  target 'AppTests'", "  pod 'Alamofire'\n  target 'AppTests'"))],
    ["a pod from git", () => podfileFindings(swap(PODFILE, `pod 'Capacitor', :path => '${CAPACITOR_PATH}'`, "pod 'Capacitor', :git => 'https://example.invalid/c.git'"))],
    ["a spec source", () => podfileFindings(`source 'https://cdn.cocoapods.org/'\n${PODFILE}`)],
    ["iOS 15", () => podfileFindings(swap(PODFILE, "platform :ios, '16.0'", "platform :ios, '15.0'"))],
    ["another locked pod", () => podlockFindings(swap(PODLOCK, "  - CapacitorCordova (8.6.0)\n", "  - CapacitorCordova (8.6.0)\n  - Alamofire (5.0.0)\n"))],
    ["another version", () => podlockFindings(swap(PODLOCK, "  - Capacitor (8.6.0):", "  - Capacitor (8.5.0):"))],
    ["a spec repo", () => podlockFindings(`${PODLOCK}\nSPEC REPOS:\n  trunk:\n    - Alamofire\n`)],
    ["server.url", () => configFindings(swap(CONFIG_JSON, '"hostname": "localhost"', '"hostname": "localhost", "url": "http://10.0.2.2:5173"'))],
    ["allowNavigation", () => configFindings(swap(CONFIG_JSON, '"hostname": "localhost"', '"hostname": "localhost", "allowNavigation": ["*"]'))],
    ["web debugging", () => configFindings(swap(CONFIG_JSON, '"zoomEnabled": false', '"zoomEnabled": false, "webContentsDebuggingEnabled": true'))],
    ["HTTP switched on", () => configFindings(swap(CONFIG_JSON, '"CapacitorHttp": { "enabled": false }', '"CapacitorHttp": { "enabled": true }'))],
    ["a plugin class", () => configFindings(swap(CONFIG_JSON, '"packageClassList": []', '"packageClassList": ["SpeechPlugin"]'))],
  ];
  const missed = planted.filter(([, findings]) => findings().length === 0).map(([name]) => name);
  assert.deepEqual(missed, []);
});

test("the plist reader reads what the files use and refuses the rest", () => {
  assert.deepEqual(readPlist("<plist><dict><key>a</key><array><integer>1</integer><string>x &amp; y</string><dict/></array></dict></plist>"), {
    a: [1, "x & y", {}],
  });
  assert.throws(() => readPlist("<plist><dict><key>a</key><real>1.5</real></dict></plist>"));
  assert.throws(() => readPlist("<plist><dict><key>a</key><true/><key>a</key><false/></dict></plist>"));
  assert.throws(() => readPlist("<plist><dict><key>a</key><true/></dict><dict/></plist>"));
});
