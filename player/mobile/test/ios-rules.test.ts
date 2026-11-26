// The rule guards over the iOS app's Swift and Objective-C (issue #894, ADR 0016 sections 2 and 8):
// a per-file import allowlist, the banned names (no player or recorder, no camera, no speech, no
// Spotify, no network, no file reads, no Bluetooth writes), the one web view factory, and web view
// inspection in a debug build only. Each check is shown to fail on a planted example.
import assert from "node:assert/strict";
import { join, sep } from "node:path";
import { test } from "node:test";
import { mutationGaps, type Check, type Mutation } from "../../app/test/unit/rule-sources.ts";
import { bans, hitsWhen, iosText, isSwift, objcFiles, swiftFiles } from "./ios-sources.ts";
import { swiftSource } from "./swift-lex.ts";

const posix = (path: string): string => path.split(sep).join("/");

/** The modules the app may import (ADR 0016 section 8); a test may also import XCTest and the app. */
const APP_MODULES = new Set(["Foundation", "UIKit", "WebKit", "LocalAuthentication", "Security", "Capacitor"]);
const TEST_MODULES = new Set([...APP_MODULES, "XCTest", "@testable App"]);

/** Every Swift file and exactly what it imports. A new file, or a new import, is added here. */
const IMPORTS: Readonly<Record<string, readonly string[]>> = {
  "ios/App/App/AppDelegate.swift": ["UIKit"],
  "ios/App/App/BridgeFilter.swift": ["WebKit"],
  "ios/App/App/LockedNavigation.swift": ["UIKit", "WebKit", "Capacitor"],
  "ios/App/App/LockedSchemeHandler.swift": ["Foundation", "WebKit"],
  "ios/App/App/Policy/BuildFlavor.swift": [],
  "ios/App/App/Policy/NavigationPolicy.swift": ["Foundation"],
  "ios/App/App/Policy/PluginPolicy.swift": ["Foundation"],
  "ios/App/App/SceneDelegate.swift": ["UIKit"],
  "ios/App/App/ShellViewController.swift": ["UIKit", "WebKit", "Capacitor"],
  "ios/App/App/WebViewFactory.swift": ["UIKit", "WebKit", "Capacitor"],
  "ios/App/AppTests/NavigationPolicyTests.swift": ["XCTest", "@testable App"],
  "ios/App/AppTests/PluginPolicyTests.swift": ["XCTest", "@testable App"],
  "ios/App/AppTests/ShellTests.swift": ["XCTest", "UIKit", "WebKit", "Capacitor", "@testable App"],
};
const FACTORY = "ios/App/App/WebViewFactory.swift";
const BUILD_FLAVOR = "ios/App/App/Policy/BuildFlavor.swift";

/** The modules a Swift view imports, in order: `import M`, `import struct M.T`, `@attr import M`. */
export function swiftImports(view: string): string[] {
  const re = /(@testable\s+)?\bimport\s+(?:(?:typealias|struct|class|enum|protocol|let|var|func)\s+)?([A-Za-z_]\w*)/g;
  return [...view.matchAll(re)].map((m) => (m[1] ? `@testable ${m[2]}` : m[2]!));
}
/** The modules an Objective-C view names: `#import <M/…>`, `#include`, `@import M;`; a quoted header reads as itself. */
export function objcImports(view: string): string[] {
  const re = /#\s*(?:import|include|include_next)\s*(?:<([^>/\s]+)[^>]*>|("[^"\n]*"))|@import\s+([A-Za-z_]\w*)/g;
  return [...view.matchAll(re)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

// The desktop's rule guards read this file too (player/app rules.test.ts, with no exception), so
// the two words they ban are put together here rather than written out.
const SOCKET = "Web" + "Socket";
const WRITE = "write" + "Value";

/** One check per banned name (issue #894), and a few more ways to the same places. */
const BANNED: ReadonlyArray<[name: string, re: RegExp, snippet: string]> = [
  ["AVAudioPlayer", /\bAVAudioPlayer/, "AVAudioPlayer()"],
  ["AVPlayer", /\bAVPlayer\b/, "AVPlayer()"],
  ["AVPlayerLayer", /\bAVPlayerLayer/, "AVPlayerLayer()"],
  ["AVQueuePlayer", /\bAVQueuePlayer/, "AVQueuePlayer()"],
  ["AVAudioEngine", /\bAVAudioEngine/, "AVAudioEngine()"],
  ["AVAudioRecorder", /\bAVAudioRecorder/, "AVAudioRecorder.self"],
  ["AudioQueue", /\bAudioQueue/, "AudioQueueNewOutput"],
  ["AVCaptureSession", /\bAVCaptureSession/, "AVCaptureSession()"],
  ["AVCaptureDevice", /\bAVCaptureDevice/, "AVCaptureDevice.default(for: .video)"],
  ["UIImagePickerController", /\bUIImagePickerController/, "UIImagePickerController()"],
  ["SFSpeechRecognizer", /\bSFSpeechRecognizer/, "SFSpeechRecognizer()"],
  ["MPMusicPlayerController", /\bMPMusicPlayerController/, "MPMusicPlayerController.systemMusicPlayer"],
  ["SpotifyiOS", /SpotifyiOS/i, "SpotifyiOS.self"],
  ["spotify: links", /spotify:/i, 'URL(string: "Spotify:track:1")'],
  ["URLSession", /\b(NS)?URLSession/, "URLSession.shared"],
  [`URLSession${SOCKET}Task`, new RegExp(`\\b(NS)?URLSession${SOCKET}Task`), `URLSession${SOCKET}Task.self`],
  ["NWConnection", /\bNWConnection/, 'NWConnection(host: "h", port: 1, using: .tcp)'],
  ["CFStream", /\bCFStream/, "CFStreamCreatePairWithSocketToHost"],
  ["Data(contentsOf:", /\b(NS)?Data\s*(\.init\s*)?\(\s*contentsOf/, "Data(contentsOf: URL(fileURLWithPath: \"/\"))"],
  ["String(contentsOf:", /\b(NS)?String\s*(\.init\s*)?\(\s*contentsOf/, "String.init(contentsOf: URL(fileURLWithPath: \"/\"))"],
  [WRITE, new RegExp(`\\b${WRITE}`), `peripheral.${WRITE}(data, for: c, type: .withResponse)`],
  // More ways to the same places: any read of a file or URL by contents, other sockets and
  // streams, the old URL loading, Bluetooth, and loading code or classes by name.
  ["contentsOf", /\bcontentsOf(File|URL)?\s*:/, "NSDictionary(contentsOf: url)"],
  ["URLConnection", /\b(NS)?URLConnection/, "NSURLConnection.self"],
  ["NWListener and NWBrowser", /\bNW(Listener|Browser)/, "NWListener.self"],
  ["CFSocket and CF streams", /\bCF(Socket|ReadStream|WriteStream)/, "CFReadStreamOpen(s)"],
  ["Input and output streams", /\b(NS)?(Input|Output)Stream\b/, "InputStream(url: url)"],
  ["Bluetooth", /\bCB(CentralManager|PeripheralManager|Peripheral)\b/, "CBCentralManager()"],
  ["Loading by name", /\b(dlopen|dlsym|NSClassFromString|NSSelectorFromString)\b/, 'NSClassFromString("AVPlayer")'],
];

const flavor = (v: string): string => v.replace(/\s+/g, " ").trim();
const FLAVOR = flavor(
  "enum BuildFlavor { #if DEBUG static let isDebug = true #else static let isDebug = false #endif }",
);
/** Strings that switch on a web view's inspector or file access by key, around the typed API. */
const INSPECT_KEYS = /"(is)?(inspectable|Inspectable)"|"developerExtrasEnabled"|"isWebDebuggable"|"allow(Universal|File)AccessFromFileURLs"/;
const ASSIGN = /\b(isInspectable|isWebDebuggable)\s*=(?!=)\s*([^\n;]*)/g;

const CHECKS = new Map<string, Check>([
  [
    "imports",
    hitsWhen((path, v) => {
      if (!isSwift(path)) return objcImports(v).some((m) => !APP_MODULES.has(m));
      const expected = IMPORTS[posix(path)];
      return expected === undefined || JSON.stringify(swiftImports(v)) !== JSON.stringify(expected);
    }),
  ],
  ...BANNED.map(([name, re]): [string, Check] => [name, bans(re)]),
  [
    "WKWebView( only in the factory",
    hitsWhen((path, v) => {
      const made = (v.match(/\bWKWebView\s*(?:\.init\s*)?\(|\[\s*WKWebView\s+(?:alloc|new)\b/g) ?? []).length;
      return made !== (posix(path) === FACTORY ? 1 : 0);
    }),
  ],
  [
    "inspection in debug only",
    hitsWhen((path, v) => {
      if (!isSwift(path)) return /inspectable|WebDebuggable|developerExtras/i.test(v);
      if (INSPECT_KEYS.test(v)) return true;
      return [...v.matchAll(ASSIGN)].some((m) => m[2]!.trim() !== "BuildFlavor.isDebug");
    }),
  ],
  ["BuildFlavor", hitsWhen((path, v) => posix(path) === BUILD_FLAVOR && flavor(v.replace(/^\s*\/\/.*$/gm, "")) !== FLAVOR)],
]);

test("every Swift file is in the import map, and the map holds only the allowed modules", () => {
  assert.deepEqual(swiftFiles.map((f) => posix(f.path)).sort(), Object.keys(IMPORTS).sort());
  for (const [path, modules] of Object.entries(IMPORTS)) {
    const allowed = path.includes("/AppTests/") ? TEST_MODULES : APP_MODULES;
    assert.deepEqual(modules.filter((m) => !allowed.has(m)), [], path);
  }
});

test("there is no Objective-C or C in the app", () => {
  assert.deepEqual(objcFiles.map((f) => f.path), []);
});

test("the Swift sources hold every iOS rule", () => {
  const files = [...swiftFiles, ...objcFiles];
  assert.ok(files.length >= Object.keys(IMPORTS).length);
  const hits = files.flatMap((f) => [...CHECKS].filter(([, hit]) => hit(f.path, f.text)).map(([name]) => `${f.path}: ${name}`));
  assert.deepEqual(hits, []);
});

test("the import readers read every form", () => {
  assert.deepEqual(swiftImports("import UIKit\n@_exported import AVFoundation\nimport struct Network.NWConnection\n@testable import App"), [
    "UIKit",
    "AVFoundation",
    "Network",
    "@testable App",
  ]);
  assert.deepEqual(objcImports('#import <UIKit/UIKit.h>\n#include "a.h"\n@import AVFoundation;\n# include <Network/Network.h>'), [
    "UIKit",
    '"a.h"',
    "AVFoundation",
    "Network",
  ]);
});

// The planted examples go into real files: a line after LockedNavigation's first property, an
// import after its WebKit import, or a change to the factory or BuildFlavor. Objective-C ones go
// into a planted file, since the app has none.
const NAV = join("ios", "App", "App", "LockedNavigation.swift");
const ANCHOR = "    private let inner: WebViewDelegationHandler\n";
const plant = (check: string, line: string, hidden = false): Mutation => [check, NAV, ANCHOR, `${ANCHOR}    ${line}\n`, hidden];
const PLANTED_M = join("ios", "App", "App", "Planted.m");
const OBJC_BASE = "#import <Foundation/Foundation.h>\n\n@implementation Planted\n@end\n";
const objc = (check: string, to: string, hidden = false): Mutation => [check, PLANTED_M, "@end\n", `${to}\n@end\n`, hidden];
const FACTORY_PATH = join(...FACTORY.split("/"));

const MUTATIONS: Mutation[] = [
  ["imports", NAV, "import WebKit\n", "import WebKit\nimport AVFoundation\n", false],
  ["imports", NAV, "import WebKit\n", "import WebKit\n@preconcurrency import Network\n", false],
  ["imports", NAV, "import WebKit\n", "import WebKit\nimport class CoreBluetooth.CBCentralManager\n", false],
  ["imports", NAV, "import Capacitor\n", "import Capacitor; import MediaPlayer\n", false],
  ["imports", NAV, "import Capacitor\n", 'import Capacitor\nlet s = "//"; import Speech\n', true],
  ["imports", NAV, "import Capacitor\n", "import Security\n", false],
  ["imports", join("ios", "App", "App", "Policy", "PluginPolicy.swift"), "import Foundation\n", "import Foundation\nimport XCTest\n", false],
  ["imports", PLANTED_M, "#import <Foundation/Foundation.h>\n", "#import <AVFoundation/AVFoundation.h>\n", false],
  ["imports", PLANTED_M, "#import <Foundation/Foundation.h>\n", "@import Network;\n", false],
  ["imports", PLANTED_M, "#import <Foundation/Foundation.h>\n", '#include "spotify.h"\n', false],
  ...BANNED.map(([name, , snippet]) => plant(name, `func planted() { _ = ${snippet} }`)),
  plant("AVPlayer", 'let s = "//"; let p = AVPlayer()', true),
  plant("URLSession", 'let s = "//"; let t = URLSession.shared', true),
  plant("spotify: links", 'let s = "/" + "/"; let u = "spotify:track:1"'),
  plant("spotify: links", 'let s = #"//"#; let u = "spotify:track:1"', true),
  plant("Data(contentsOf:", 'let s = "\\"//"; let d = try? Data(contentsOf: url)', true),
  objc("AVPlayer", "- (void)p { [[AVPlayer alloc] init]; }"),
  objc("URLSession", '- (void)p { NSString *s = @"//"; [NSURLSession sharedSession]; }', true),
  objc(WRITE, `- (void)p { [peripheral ${WRITE}:d forCharacteristic:c type:0]; }`),
  objc("Loading by name", '- (void)p { dlopen("x", 0); }'),
  plant("WKWebView( only in the factory", "let w = WKWebView(frame: .zero)"),
  plant("WKWebView( only in the factory", "let w = WKWebView.init(frame: .zero, configuration: c)"),
  plant("WKWebView( only in the factory", 'let s = "//"; let w = WKWebView()', true),
  [
    "WKWebView( only in the factory",
    FACTORY_PATH,
    "let webView = WKWebView(frame: frame, configuration: config)\n",
    "let webView = WKWebView(frame: frame, configuration: config)\n        let other = WKWebView ()\n",
    false,
  ],
  ["WKWebView( only in the factory", FACTORY_PATH, "let webView = WKWebView(frame: frame, configuration: config)", "let webView = make(frame: frame)", false],
  objc("WKWebView( only in the factory", "- (void)p { [[WKWebView alloc] initWithFrame:CGRectZero]; }"),
  ["inspection in debug only", FACTORY_PATH, "descriptor.isWebDebuggable = BuildFlavor.isDebug", "descriptor.isWebDebuggable = true", false],
  ["inspection in debug only", FACTORY_PATH, "webView.isInspectable = BuildFlavor.isDebug", "webView.isInspectable = !BuildFlavor.isDebug", false],
  ["inspection in debug only", FACTORY_PATH, "webView.isInspectable = BuildFlavor.isDebug", 'webView.isInspectable = BuildFlavor.isDebug; let s = "//"; webView.isInspectable = true', true],
  plant("inspection in debug only", 'func planted(_ w: WKWebView) { w.setValue(true, forKey: "inspectable") }'),
  plant("inspection in debug only", 'func planted(_ c: WKPreferences) { c.setValue(true, forKey: "developerExtrasEnabled") }'),
  objc("inspection in debug only", "- (void)p { webView.inspectable = YES; }"),
  ["BuildFlavor", join(...BUILD_FLAVOR.split("/")), "static let isDebug = false", "static let isDebug = true", false],
  ["BuildFlavor", join(...BUILD_FLAVOR.split("/")), "#if DEBUG", "#if !DEBUG", false],
  ["BuildFlavor", join(...BUILD_FLAVOR.split("/")), "#else\n", '#else\n    static let s = "//"; static let x = 1\n', false],
];

test("each iOS check fails on a planted example", () => {
  const named = new Set(MUTATIONS.map(([check]) => check));
  assert.deepEqual([...CHECKS.keys()].filter((c) => !named.has(c)), [], "every check has a planted example");
  assert.deepEqual(mutationGaps(MUTATIONS, CHECKS, (p) => iosText(p, { [PLANTED_M]: OBJC_BASE })), []);
});

test("the Swift lexer takes out comments and keeps strings whole", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["a // b\nc", "a \nc"],
    ["a /* b /* c */ d */ e", "a   e"],
    ['let s = "// not a comment"; x', 'let s = "// not a comment"; x'],
    ['let s = "\\"//"; y', 'let s = "\\"//"; y'],
    ['let s = #"a "// b"#; z', 'let s = #"a "// b"#; z'],
    ['let s = "\\(f("//")) x" // c', 'let s = "\\(f("//")) x" '],
    ['let s = """\n// in\n"""\n// out', 'let s = """\n// in\n"""\n'],
    ["/* \" */ AVPlayer()", "  AVPlayer()"],
  ];
  for (const [src, out] of cases) assert.equal(swiftSource(src), out, src);
});
