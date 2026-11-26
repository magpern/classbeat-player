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
import { IOS, swiftFiles } from "./ios-sources.ts";
import { buildConfigs, decodeString, fileRefs, groups, objectKinds, parsePbxproj, setting, settingKeys, shellScripts } from "./pbxproj.ts";
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

/** The build settings the project may set. Nothing that adds Info.plist keys (INFOPLIST_KEY_*,
 * INFOPLIST_PREPROCESS), entitlements, linker or compiler flags, or another plist. */
const SETTING_KEYS = new Set(
  (
    "ALWAYS_SEARCH_USER_PATHS ASSETCATALOG_COMPILER_APPICON_NAME ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME BUNDLE_LOADER " +
    "CLANG_ANALYZER_NONNULL CLANG_ANALYZER_NUMBER_OBJECT_CONVERSION CLANG_CXX_LANGUAGE_STANDARD CLANG_CXX_LIBRARY CLANG_ENABLE_MODULES " +
    "CLANG_ENABLE_OBJC_ARC CLANG_ENABLE_OBJC_WEAK CLANG_WARN_BLOCK_CAPTURE_AUTORELEASING CLANG_WARN_BOOL_CONVERSION CLANG_WARN_COMMA " +
    "CLANG_WARN_CONSTANT_CONVERSION CLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS CLANG_WARN_DIRECT_OBJC_ISA_USAGE " +
    "CLANG_WARN_DOCUMENTATION_COMMENTS CLANG_WARN_EMPTY_BODY CLANG_WARN_ENUM_CONVERSION CLANG_WARN_INFINITE_RECURSION " +
    "CLANG_WARN_INT_CONVERSION CLANG_WARN_NON_LITERAL_NULL_CONVERSION CLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF " +
    "CLANG_WARN_OBJC_LITERAL_CONVERSION CLANG_WARN_OBJC_ROOT_CLASS CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER " +
    "CLANG_WARN_RANGE_LOOP_ANALYSIS CLANG_WARN_STRICT_PROTOTYPES CLANG_WARN_SUSPICIOUS_MOVE CLANG_WARN_UNGUARDED_AVAILABILITY " +
    "CLANG_WARN_UNREACHABLE_CODE CLANG_WARN__DUPLICATE_METHOD_MATCH CODE_SIGN_STYLE COPY_PHASE_STRIP CURRENT_PROJECT_VERSION " +
    "DEBUG_INFORMATION_FORMAT ENABLE_NS_ASSERTIONS ENABLE_STRICT_OBJC_MSGSEND ENABLE_TESTABILITY GCC_C_LANGUAGE_STANDARD " +
    "GCC_DYNAMIC_NO_PIC GCC_NO_COMMON_BLOCKS GCC_OPTIMIZATION_LEVEL GCC_PREPROCESSOR_DEFINITIONS GCC_WARN_64_TO_32_BIT_CONVERSION " +
    "GCC_WARN_ABOUT_RETURN_TYPE GCC_WARN_UNDECLARED_SELECTOR GCC_WARN_UNINITIALIZED_AUTOS GCC_WARN_UNUSED_FUNCTION " +
    "GCC_WARN_UNUSED_VARIABLE GENERATE_INFOPLIST_FILE INFOPLIST_FILE IPHONEOS_DEPLOYMENT_TARGET LD_RUNPATH_SEARCH_PATHS " +
    "MARKETING_VERSION MTL_ENABLE_DEBUG_INFO MTL_FAST_MATH ONLY_ACTIVE_ARCH PRODUCT_BUNDLE_IDENTIFIER PRODUCT_NAME SDKROOT " +
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS SWIFT_COMPILATION_MODE SWIFT_OPTIMIZATION_LEVEL SWIFT_VERSION TARGETED_DEVICE_FAMILY " +
    "TEST_HOST VALIDATE_PRODUCT"
  ).split(" "),
);
/** The object kinds the project may hold: no copy-files phase, build rule, package or reference proxy. */
const OBJECT_KINDS = new Set([
  "PBXBuildFile", "PBXContainerItemProxy", "PBXFileReference", "PBXFrameworksBuildPhase", "PBXGroup", "PBXNativeTarget",
  "PBXProject", "PBXResourcesBuildPhase", "PBXShellScriptBuildPhase", "PBXSourcesBuildPhase", "PBXTargetDependency",
  "XCBuildConfiguration", "XCConfigurationList",
]);
/** The files the project names, other than its Swift sources: CocoaPods' generated configuration
 * files (in the git-ignored Pods), the plists, the config, the pages, the products, Foundation and
 * the pods' framework. No other framework, library, xcconfig or source. */
const PODS_XCCONFIGS = ["App", "AppTests"].flatMap((t) =>
  ["debug", "release"].map((c) => `text.xcconfig|<group>|Target Support Files/Pods-${t}/Pods-${t}.${c}.xcconfig`),
);
const FILE_REFS = new Set([
  ...PODS_XCCONFIGS,
  "text.plist.xml|<group>|Info.plist",
  "text.plist.xml|<group>|Info-Debug.plist",
  "none|<group>|capacitor.config.json",
  "folder|<group>|public",
  "wrapper.application|BUILT_PRODUCTS_DIR|App.app",
  "wrapper.cfbundle|BUILT_PRODUCTS_DIR|AppTests.xctest",
  "wrapper.framework|DEVELOPER_DIR|Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk/System/Library/Frameworks/Foundation.framework",
  "wrapper.framework|BUILT_PRODUCTS_DIR|Pods_App.framework",
  "wrapper.framework|BUILT_PRODUCTS_DIR|Pods_AppTests.framework",
]);
const GROUPS = ["||<group>", "Pods|Pods|<group>", "App|App|<group>", "AppTests|AppTests|<group>", "Frameworks||<group>", "Policy|Policy|<group>", "Products||<group>", "iOS||<group>"];
/** CocoaPods' own script phases, as pod install writes them: the lock check (twice) and the framework embed. */
const CHECK_LOCK =
  'diff \\"${PODS_PODFILE_DIR_PATH}/Podfile.lock\\" \\"${PODS_ROOT}/Manifest.lock\\" > /dev/null\\nif [ $? != 0 ] ; then\\n    # print error to STDERR\\n    echo \\"error: The sandbox is not in sync with the Podfile.lock. Run \'pod install\' or update your CocoaPods installation.\\" >&2\\n    exit 1\\nfi\\n# This output is used by Xcode \'outputs\' to avoid re-running this script phase.\\necho \\"SUCCESS\\" > \\"${SCRIPT_OUTPUT_FILE_0}\\"\\n';
const SCRIPTS = [CHECK_LOCK, CHECK_LOCK, '\\"${PODS_ROOT}/Target Support Files/Pods-App/Pods-App-frameworks.sh\\"\\n'].map(
  (s) => `/bin/sh|${decodeString(s)}`,
);

/** What is wrong with the Xcode project, one line each. */
export function projectFindings(pbxproj: string): string[] {
  try {
    return readProjectFindings(pbxproj);
  } catch (e) {
    return [`the project could not be read: ${(e as Error).message}`];
  }
}

function readProjectFindings(pbxproj: string): string[] {
  const found: string[] = [];
  const configs = buildConfigs(pbxproj);
  for (const c of configs) {
    const flags = Object.entries(c.settings).filter(([k]) => !/^(DEBUG_INFORMATION_FORMAT|MTL_ENABLE_DEBUG_INFO)$/.test(k));
    if (c.name !== "Debug" && /DEBUG/.test(JSON.stringify(flags))) found.push(`${c.name}: compiles with DEBUG`);
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
    if (pbxproj.includes(banned) || decoded(pbxproj).includes(banned)) found.push(`the project has ${banned}`);
  }
  return [...found, ...infoSourceFindings(pbxproj), ...shapeFindings(pbxproj)];
}

/**
 * The app's Info.plist comes from its file alone: GENERATE_INFOPLIST_FILE is NO wherever the
 * app's plist is named, only a test bundle (TEST_HOST) may generate its own, no INFOPLIST_ setting
 * but the file, and no setting outside the allowlist (Xcode would merge INFOPLIST_KEY_* into the
 * shipped plist, around the plist checks).
 */
function infoSourceFindings(pbxproj: string): string[] {
  const found: string[] = [];
  // A second line of defence: no INFOPLIST_ name but the file anywhere, as written or decoded.
  for (const text of [pbxproj, decoded(pbxproj)]) {
    for (const m of text.matchAll(/INFOPLIST_(?!FILE\b)\w*/g)) found.push(`the project names ${m[0]}`);
  }
  for (const c of buildConfigs(pbxproj)) {
    const generate = setting(c, "GENERATE_INFOPLIST_FILE");
    if (setting(c, "INFOPLIST_FILE") !== undefined && generate !== "NO") found.push(`${c.name}: the app's Info.plist is generated`);
    if (generate !== undefined && generate !== "NO" && setting(c, "TEST_HOST") === undefined) found.push(`${c.name}: generates an Info.plist`);
    for (const key of settingKeys(c)) {
      if (/^INFOPLIST_/.test(key) && key !== "INFOPLIST_FILE") found.push(`${c.name}: sets ${key}`);
      else if (!SETTING_KEYS.has(key)) found.push(`${c.name}: ${key} is not an allowed setting`);
    }
  }
  return found;
}

/** Every key and string of the parsed project, decoded, as one text. */
const decoded = (pbxproj: string): string => JSON.stringify(parsePbxproj(pbxproj));

/** The project holds only the objects, files, groups, base configurations and scripts above. */
function shapeFindings(pbxproj: string): string[] {
  const found: string[] = [];
  for (const kind of new Set(objectKinds(pbxproj))) if (!OBJECT_KINDS.has(kind)) found.push(`the project has a ${kind}`);
  const swift = new Set(swiftFiles.map((f) => f.path.split(/[\\/]/).pop()));
  const refs = fileRefs(pbxproj);
  if (refs.length !== [...pbxproj.matchAll(/isa = PBXFileReference;/g)].length) found.push("a file reference could not be read");
  for (const r of refs) {
    const key = `${r.type}|${r.sourceTree}|${r.path.replace(/iPhoneOS[\d.]*\.sdk/, "iPhoneOS.sdk")}`;
    const ok = r.type === "sourcecode.swift" ? r.sourceTree === "<group>" && swift.has(r.path) : FILE_REFS.has(key);
    if (!ok) found.push(`the project names ${key}`);
  }
  const xcconfigs = new Set(refs.filter((r) => r.type === "text.xcconfig").map((r) => r.id));
  for (const c of buildConfigs(pbxproj)) {
    if (c.base !== undefined && !xcconfigs.has(c.base)) found.push(`${c.name}: its base configuration is not a pods configuration`);
  }
  if (!isDeepStrictEqual(groups(pbxproj).sort(), [...GROUPS].sort())) found.push(`the groups are ${groups(pbxproj).join(", ")}`);
  if (!isDeepStrictEqual(shellScripts(pbxproj), SCRIPTS)) found.push("a script phase is not one of CocoaPods' own");
  return found;
}

const SCHEME_ELEMENTS = new Set(
  ("AnalyzeAction ArchiveAction BuildAction BuildActionEntries BuildActionEntry BuildableProductRunnable BuildableReference " +
    "LaunchAction MacroExpansion ProfileAction Scheme TestAction TestableReference Testables").split(" "),
);
/** What is wrong with the shared scheme: an archive (the build that ships) is a release build. */
export function schemeFindings(scheme: string): string[] {
  const found: string[] = [];
  // Each of the two actions once, its configuration Release, however the tag is laid out.
  for (const action of ["ArchiveAction", "ProfileAction"]) {
    const tags = [...scheme.matchAll(new RegExp(`<\\s*${action}\\b([^>]*)>`, "g"))].map((m) => m[1]!);
    const configs = tags.map((t) => /\bbuildConfiguration\s*=\s*"([^"]*)"/.exec(t)?.[1]);
    if (configs.length !== 1 || configs[0] !== "Release") found.push(`${action} is not Release`);
  }
  // Only the elements the scheme has now: no other element, comment, CDATA, entity or instruction.
  const extra = [...scheme.replace(/^<\?xml [^>]*\?>/, "").matchAll(/<\s*\/?\s*([^\s/>]+)/g)].map((m) => m[1]!).filter((n) => !SCHEME_ELEMENTS.has(n));
  for (const n of new Set(extra)) found.push(`the scheme has <${n}>`);
  if (/&/.test(scheme)) found.push("the scheme has an entity");
  // A scheme action can run a script or change the launch (pre and post actions, environment
  // variables, arguments); the project runs only the pinned CocoaPods phases.
  for (const m of scheme.matchAll(/<(PreActions|PostActions|ExecutionAction|EnvironmentVariables?|CommandLineArguments?|AdditionalOptions)\b|DYLD_/g)) {
    found.push(`the scheme has ${m[1] ?? m[0]}`);
  }
  return found;
}

const CAPACITOR_PATH = "../../node_modules/@capacitor/ios";
const PODFILE_LINES = [
  `require_relative '${CAPACITOR_PATH}/scripts/pods_helpers'`,
  "platform :ios, '16.0'",
  "use_frameworks!",
  "install! 'cocoapods', :disable_input_output_paths => true",
  "target 'App' do",
  ...["Capacitor", "CapacitorCordova"].map((n) => `pod '${n}', :path => '${CAPACITOR_PATH}'`),
  "target 'AppTests' do",
  "inherit! :search_paths",
  "end",
  "end",
  "post_install do |installer|",
  "assertDeploymentTarget(installer)",
  "end",
];
/** What is wrong with the Podfile: only Capacitor's own pods, from the pinned package, iOS 16. */
export function podfileFindings(podfile: string): string[] {
  const found: string[] = [];
  // Whole-line comments only: a "#" after a statement may sit inside a Ruby string.
  const lines = podfile.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  const pods = lines.filter((l) => /^pod\b/.test(l));
  const expected = ["Capacitor", "CapacitorCordova"].map((n) => `pod '${n}', :path => '${CAPACITOR_PATH}'`);
  if (!isDeepStrictEqual(pods, expected)) found.push(`the pods are ${pods.join("; ")}`);
  if (!lines.includes("platform :ios, '16.0'")) found.push("the platform is not iOS 16.0");
  for (const l of lines) if (/^(source|plugin)\b|:git\b|:http\b|:podspec\b|\bgem\b/.test(l)) found.push(`not allowed: ${l}`);
  // Ruby runs at pod install, so the Podfile is exactly these statements: no other hook or call.
  if (!isDeepStrictEqual(lines, PODFILE_LINES)) found.push("the Podfile is not exactly the allowed statements");
  return found;
}

const LOCK_FROM = '"../../node_modules/@capacitor/ios"';
const LOCK_LINES = [
  "PODS:", "  - Capacitor (8.6.0):", "    - CapacitorCordova", "  - CapacitorCordova (8.6.0)", "",
  "DEPENDENCIES:", '  - "Capacitor (from `../../node_modules/@capacitor/ios`)"', '  - "CapacitorCordova (from `../../node_modules/@capacitor/ios`)"', "",
  "EXTERNAL SOURCES:", "  Capacitor:", `    :path: ${LOCK_FROM}`, "  CapacitorCordova:", `    :path: ${LOCK_FROM}`, "",
  "SPEC CHECKSUMS:", "  Capacitor: @sum", "  CapacitorCordova: @sum", "",
  "PODFILE CHECKSUM: @sum", "", "COCOAPODS: @version",
];
const LOCK = new RegExp(
  `^${LOCK_LINES.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\n").replaceAll("@sum", "[0-9a-f]{40}").replace("@version", "\\d+\\.\\d+\\.\\d+")}\n?$`,
);
/** What is wrong with Podfile.lock: the same two pods at 8.6.0, nothing from a spec repository. */
export function podlockFindings(lock: string): string[] {
  const found: string[] = [];
  const section = /^PODS:\n((?: {2}.*\n)+)/m.exec(lock)?.[1] ?? "";
  const pods = [...section.matchAll(/^ {2}- "?([^\s"(]+) \(([^)]*)\)/gm)].map((m) => `${m[1]} ${m[2]}`);
  if (!isDeepStrictEqual(pods, ["Capacitor 8.6.0", "CapacitorCordova 8.6.0"])) found.push(`the locked pods are ${pods.join(", ")}`);
  if (/^SPEC REPOS:/m.test(lock)) found.push("a pod comes from a spec repository");
  // The whole file, as pod install writes it for the two path pods: only the checksums may differ.
  if (!LOCK.test(lock)) found.push("Podfile.lock is not the two pinned pods");
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

/** What is wrong with the files under ios/: an entitlements file (no entitlements at all), a Swift
 * package, a build configuration file of our own, or compiled code (a library, a framework, a
 * module interface) that the guards cannot read. */
const BANNED_FILE =
  /\.(entitlements|xcconfig|a|o|dylib|tbd|so|swiftinterface|swiftmodule|xcarchive)$|\.(xc)?framework([\\/]|$)|(^|[\\/])Package\.(swift|resolved)$/;
/** The one scheme: any other (a user scheme, a second shared one) is a place for unchecked actions. */
const SCHEME_PATH = "ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme";
export const fileFindings = (paths: readonly string[]): string[] =>
  paths
    .map((p) => p.replaceAll("\\", "/"))
    .filter((p) => BANNED_FILE.test(p) || (/\.xcscheme$/.test(p) && p !== SCHEME_PATH))
    .map((p) => `${p} is not allowed`);

test("there are no entitlements, Swift packages, xcconfig files or compiled code", () => {
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
  // An entry may name the finding it must give, so a plant shows the check it is for.
  const planted: ReadonlyArray<[name: string, findings: () => string[], expect?: string]> = [
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
    ["a generated app plist", () => projectFindings(swap(PBXPROJ, "GENERATE_INFOPLIST_FILE = NO;", "GENERATE_INFOPLIST_FILE = YES;"))],
    ["a camera key through settings", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tINFOPLIST_KEY_NSCameraUsageDescription = x;"))],
    ["a camera key in a test bundle", () => projectFindings(swap(PBXPROJ, "TEST_HOST = ", 'INFOPLIST_KEY_NSCameraUsageDescription = "x";\n\t\t\t\tTEST_HOST = '))],
    ["a conditional key", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", 'INFOPLIST_FILE = App/Info.plist;\n\t\t\t\t"INFOPLIST_KEY_NSMicrophoneUsageDescription[sdk=iphoneos*]" = x;'))],
    ["a preprocessed plist", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tINFOPLIST_PREPROCESS = YES;"))],
    ["a generated plist elsewhere", () => projectFindings(swap(PBXPROJ, "ENABLE_NS_ASSERTIONS = NO;", "ENABLE_NS_ASSERTIONS = NO;\n\t\t\t\tGENERATE_INFOPLIST_FILE = YES;"))],
    ["a camera key on a deeper line", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\t\tINFOPLIST_KEY_NSCameraUsageDescription = x;")), "Release: sets INFOPLIST_KEY_NSCameraUsageDescription"],
    ["a camera key on the plist's line", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist; INFOPLIST_KEY_NSCameraUsageDescription = x;")), "Release: sets INFOPLIST_KEY_NSCameraUsageDescription"],
    ["a camera key over several lines", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\nINFOPLIST_KEY_NSCameraUsageDescription\n=\n\"x\"\n;")), "Release: sets INFOPLIST_KEY_NSCameraUsageDescription"],
    ["a quoted camera key", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\t\"INFOPLIST_KEY_NSCameraUsageDescription\" = x;")), "Release: sets INFOPLIST_KEY_NSCameraUsageDescription"],
    ["an escaped camera key", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\t\"INFOPLIST_\\U004BEY_NSCameraUsageDescription\" = x;")), "Release: sets INFOPLIST_KEY_NSCameraUsageDescription"],
    ["a camera key in a comment", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist; /* INFOPLIST_KEY_NSCameraUsageDescription */")), "the project names INFOPLIST_KEY_NSCameraUsageDescription"],
    ["linker flags on the plist's line", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist; OTHER_LDFLAGS = \"-ObjC\";")), "Release: OTHER_LDFLAGS is not an allowed setting"],
    ["linker flags behind a comment", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tOTHER_LDFLAGS /* = */ = (\n\"-ObjC\",\n);")), "Release: OTHER_LDFLAGS is not an allowed setting"],
    ["a conditional setting", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\t\"OTHER_LDFLAGS[sdk=iphoneos*]\" = x;")), "is not an allowed setting"],
    ["a repeated setting", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tINFOPLIST_FILE = App/Other.plist;")), "is repeated"],
    ["an escaped configuration kind", () => projectFindings(swap(PBXPROJ, "isa = XCBuildConfiguration;", "isa = \"XCBuild\\U0043onfiguration\";")), "build configurations read"],
    ["settings on another object", () => projectFindings(swap(PBXPROJ, "isa = PBXProject;", "isa = PBXProject;\n\t\t\tbuildSettings = {\n\t\t\t\tOTHER_LDFLAGS = x;\n\t\t\t};")), "has build settings"],
    ["a script run by another shell", () => projectFindings(swap(PBXPROJ, "shellPath = /bin/sh;", "shellPath = /usr/bin/python3;")), "a script phase is not one of CocoaPods' own"],
    ["a framework written over several lines", () => projectFindings(swap(PBXPROJ, "/* Begin PBXFileReference section */", "/* Begin PBXFileReference section */\n\t\tAA0000000000000000000001 = {\nisa = PBXFileReference;\n\"lastKnownFileType\" = wrapper.framework;\npath = Vendor.framework;\nsourceTree = \"<group>\";\n};")), "the project names wrapper.framework|<group>|Vendor.framework"],
    ["linker flags", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", 'INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tOTHER_LDFLAGS = "-framework AVFoundation";'))],
    ["an unreadable setting line", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tINFOPLIST_KEY_X=1;"))],
    ["a base xcconfig of our own", () => projectFindings(swap(PBXPROJ, "path = \"Target Support Files/Pods-App/Pods-App.release.xcconfig\"", "path = ../Camera.xcconfig"))],
    ["a base reference elsewhere", () => projectFindings(swap(PBXPROJ, /baseConfigurationReference = 93462A6E54F9E0133EAE82F2/, "baseConfigurationReference = 697607E779A6819EAFDC36D9"))],
    ["a moved pods group", () => projectFindings(swap(PBXPROJ, "name = Pods;\n\t\t\tpath = Pods;", "name = Pods;\n\t\t\tpath = ../Elsewhere;"))],
    ["a binary framework", () => projectFindings(swap(PBXPROJ, "path = Pods_App.framework;", "path = Spotify.xcframework;"))],
    ["a static library", () => projectFindings(swap(PBXPROJ, "lastKnownFileType = wrapper.framework; name = Foundation.framework;", "lastKnownFileType = archive.ar; name = Foundation.framework;"))],
    ["an Objective-C source", () => projectFindings(swap(PBXPROJ, "lastKnownFileType = sourcecode.swift; path = BridgeFilter.swift;", "lastKnownFileType = sourcecode.c.objc; path = Bridge.m;"))],
    ["an unknown Swift file", () => projectFindings(swap(PBXPROJ, "path = BridgeFilter.swift;", "path = Other.swift;"))],
    ["a copy-files phase", () => projectFindings(`${PBXPROJ}\n\t\tAAAA = {isa = PBXCopyFilesBuildPhase; };`)],
    ["a script of our own", () => projectFindings(swap(PBXPROJ, "Pods-App-frameworks.sh", "Pods-App-frameworks.sh; /usr/libexec/PlistBuddy -c x"))],
    ["DEBUG in release", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;"))],
    ["-DDEBUG in release", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", 'INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tOTHER_SWIFT_FLAGS = "-DDEBUG";'))],
    ["the debug plist in release", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", 'INFOPLIST_FILE = "App/Info-Debug.plist";'))],
    ["deployment target", () => projectFindings(swap(PBXPROJ, "IPHONEOS_DEPLOYMENT_TARGET = 16.0;", "IPHONEOS_DEPLOYMENT_TARGET = 15.0;"))],
    ["entitlements", () => projectFindings(swap(PBXPROJ, "INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;"))],
    ["an entitlements file", () => fileFindings(["ios/App/App/App.entitlements"])],
    ["a package file", () => fileFindings(["ios/App/Package.resolved"])],
    ["an xcconfig file", () => fileFindings(["ios/App/App/Release.xcconfig"])],
    ["a static library file", () => fileFindings(["ios/App/libspeech.a"])],
    ["a binary framework file", () => fileFindings(["ios/App/Vendor/Spotify.xcframework/Info.plist"])],
    ["a module interface", () => fileFindings(["ios/App/X.swiftinterface"])],
    ["a second scheme", () => fileFindings(["ios/App/App.xcodeproj/xcuserdata/me.xcuserdatad/xcschemes/Other.xcscheme"])],
    ["a Swift package", () => projectFindings(`${PBXPROJ}\n/* XCRemoteSwiftPackageReference "x" */`)],
    ["a debug archive", () => schemeFindings(swap(SCHEME, /(<ArchiveAction\s+buildConfiguration = )"Release"/, '$1"Debug"'))],
    ["a scheme pre-action script", () => schemeFindings(swap(SCHEME, /(<BuildAction\b[^>]*>)/, '$1\n      <PreActions>\n         <ExecutionAction ActionType = "Xcode.IDEStandardExecutionActionsCore.ExecutionActionType.ShellScriptAction"/>\n      </PreActions>'))],
    ["a launch environment variable", () => schemeFindings(swap(SCHEME, /(<LaunchAction\b[^>]*>)/, '$1\n      <EnvironmentVariables>\n         <EnvironmentVariable key = "DYLD_INSERT_LIBRARIES" value = "x" isEnabled = "YES"/>\n      </EnvironmentVariables>'))],
    ["a launch argument", () => schemeFindings(swap(SCHEME, /(<LaunchAction\b[^>]*>)/, '$1\n      <CommandLineArguments>\n         <CommandLineArgument argument = "-x" isEnabled = "YES"/>\n      </CommandLineArguments>'))],
    ["another pod", () => podfileFindings(swap(PODFILE, "  target 'AppTests'", "  pod 'Alamofire'\n  target 'AppTests'"))],
    ["a pod from git", () => podfileFindings(swap(PODFILE, `pod 'Capacitor', :path => '${CAPACITOR_PATH}'`, "pod 'Capacitor', :git => 'https://example.invalid/c.git'"))],
    ["a post_install body", () => podfileFindings(swap(PODFILE, "  assertDeploymentTarget(installer)\n", "  assertDeploymentTarget(installer)\n  system('true')\n"))],
    ["a second, debug archive", () => schemeFindings(swap(SCHEME, /(\s*)<ArchiveAction\b/, '$1<ArchiveAction buildConfiguration = "Debug"></ArchiveAction>$1<ArchiveAction')), "ArchiveAction is not Release"],
    ["a pre-action over lines", () => schemeFindings(swap(SCHEME, /(<BuildAction\b[^>]*>)/, "$1\n<\n  PreActions\n></PreActions>")), "the scheme has <PreActions>"],
    ["an element in a comment", () => schemeFindings(swap(SCHEME, /(<BuildAction\b[^>]*>)/, "$1<!-- x -->")), "the scheme has <!--"],
    ["an encoded launch variable", () => schemeFindings(swap(SCHEME, /(<LaunchAction\b)/, '$1 x = "&#68;YLD_X"')), "the scheme has an entity"],
    ["a post_install call on the same line", () => podfileFindings(swap(PODFILE, "assertDeploymentTarget(installer)\n", "assertDeploymentTarget(installer); system('true')\n")), "not exactly the allowed statements"],
    ["a post_install call after a carriage return", () => podfileFindings(swap(PODFILE, "assertDeploymentTarget(installer)\n", "assertDeploymentTarget(installer)\rsystem('true')\n")), "not exactly the allowed statements"],
    ["a call after a hash", () => podfileFindings(swap(PODFILE, "use_frameworks!\n", "use_frameworks! # x\n")), "not exactly the allowed statements"],
    ["a locked pod indented further", () => podlockFindings(swap(PODLOCK, "  - CapacitorCordova (8.6.0)\n", "  - CapacitorCordova (8.6.0)\n   - Alamofire (5.0.0)\n")), "not the two pinned pods"],
    ["a quoted spec repo", () => podlockFindings(`${PODLOCK}\n"SPEC REPOS":\n  trunk:\n    - Alamofire\n`), "not the two pinned pods"],
    ["another hook", () => podfileFindings(`${PODFILE}\npre_install do |i|\nend\n`)],
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
  const missed = planted
    .filter(([, findings, expect]) => {
      const f = findings();
      return f.length === 0 || (expect !== undefined && !f.some((l) => l.includes(expect)));
    })
    .map(([name]) => name);
  assert.deepEqual(missed, []);
});

test("the plist reader reads what the files use and refuses the rest", () => {
  assert.deepEqual(readPlist("<plist><dict><key>a</key><array><integer>1</integer><string>x &amp; y</string><dict/></array></dict></plist>"), {
    a: [1, "x & y", {}],
  });
  assert.throws(() => readPlist("<plist><dict><key>a</key><real>1.5</real></dict></plist>"));
  assert.throws(() => readPlist("<plist><dict><key>a</key><true/><key>a</key><false/></dict></plist>"));
  assert.throws(() => readPlist("<plist><dict><key>a</key><true/></dict><dict/></plist>"));
  // Parts the reader would otherwise pass over: CDATA, an instruction, an entity declared or used.
  assert.throws(() => readPlist("<plist><dict><key>a</key><string><![CDATA[x]]></string></dict></plist>"));
  assert.throws(() => readPlist("<plist><?pi x?><dict/></plist>"));
  assert.throws(() => readPlist('<!DOCTYPE plist [<!ENTITY e "x">]><plist><dict><key>a</key><string>&e;</string></dict></plist>'));
  assert.throws(() => readPlist("<plist><dict><key>a</key><string>&#65;</string></dict></plist>"));
});
