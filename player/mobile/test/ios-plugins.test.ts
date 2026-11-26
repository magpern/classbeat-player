// The iOS plugin allowlist against the pinned Capacitor (issue #894, ADR 0016 section 2): the
// names in PluginPolicy.core are exactly the plugins @capacitor/ios 8.6.0 registers in every
// bridge, so a Capacitor update that adds one fails here before the app stops on it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MOBILE } from "../../app/test/unit/rule-sources.ts";
import { iosText } from "./ios-sources.ts";
import { swiftSource } from "./swift-lex.ts";

const CAPACITOR = join(MOBILE, "node_modules", "@capacitor", "ios");
const SOURCES = join(CAPACITOR, "Capacitor", "Capacitor");
const POLICY = join("ios", "App", "App", "Policy", "PluginPolicy.swift");

/** The classes CapacitorBridge.registerPlugins puts in every bridge (its `pluginList`). */
export function registeredClasses(bridge: string): string[] {
  const list = /var pluginList: \[AnyClass\] = \[([^\]]*)\]/.exec(swiftSource(bridge))?.[1];
  if (list === undefined) throw new Error("CapacitorBridge.swift has no pluginList");
  return list.split(",").map((c) => c.trim().replace(/\.self$/, ""));
}
/** Each plugin class of Capacitor's Plugins folder and the name the bridge registers it under. */
export function jsNames(files: readonly string[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const text of files.map(swiftSource)) {
    for (const m of text.matchAll(/@objc\((\w+)\)\s*public class \1\b[^{]*\{[^}]*?public let jsName = "([^"]+)"/g)) names.set(m[1]!, m[2]!);
  }
  return names;
}
/** The names in a `static let NAME: Set<String> = [...]` of PluginPolicy.swift. */
export function policySet(policy: string, name: string): string[] {
  const list = new RegExp(`static let ${name}: Set<String> = \\[([^\\]]*)\\]`).exec(swiftSource(policy))?.[1];
  if (list === undefined) throw new Error(`PluginPolicy.swift has no ${name}`);
  return [...list.matchAll(/"([^"]*)"/g)].map((m) => m[1]!).sort();
}

const BRIDGE = readFileSync(join(SOURCES, "CapacitorBridge.swift"), "utf8");
const PLUGIN_FILES = readdirSync(join(SOURCES, "Plugins"))
  .filter((n) => n.endsWith(".swift"))
  .map((n) => readFileSync(join(SOURCES, "Plugins", n), "utf8"));
const registered = (bridge: string, files: readonly string[]): string[] => {
  const names = jsNames(files);
  return registeredClasses(bridge).map((c) => names.get(c) ?? `unknown class ${c}`).sort();
};

test("the pinned Capacitor is 8.6.0", () => {
  const pkg = JSON.parse(readFileSync(join(CAPACITOR, "package.json"), "utf8")) as { version: string };
  assert.equal(pkg.version, "8.6.0");
});

test("PluginPolicy.core is what @capacitor/ios 8.6.0 registers, and nothing is callable", () => {
  const policy = iosText(POLICY);
  assert.deepEqual(registered(BRIDGE, PLUGIN_FILES), ["CapacitorCookies", "CapacitorHttp", "Console", "SystemBars", "WebView"]);
  assert.deepEqual(policySet(policy, "core"), registered(BRIDGE, PLUGIN_FILES));
  assert.deepEqual(policySet(policy, "callable"), []);
});

test("the check fails on a planted plugin, on either side", () => {
  const extraClass = BRIDGE.replace("CAPSystemBarsPlugin.self]", "CAPSystemBarsPlugin.self, CAPSpeechPlugin.self]");
  assert.notEqual(extraClass, BRIDGE);
  assert.ok(registered(extraClass, PLUGIN_FILES).includes("unknown class CAPSpeechPlugin"));
  const extraFile = '@objc(CAPSpeechPlugin)\npublic class CAPSpeechPlugin: CAPPlugin, CAPBridgedPlugin {\n    public let jsName = "Speech"\n}\n';
  assert.notDeepEqual(registered(extraClass, [...PLUGIN_FILES, extraFile]), policySet(iosText(POLICY), "core"));
  const policy = iosText(POLICY);
  const widened = policy.replace('"SystemBars"]', '"SystemBars", "Speech"]');
  assert.notEqual(widened, policy);
  assert.notDeepEqual(policySet(widened, "core"), registered(BRIDGE, PLUGIN_FILES));
  const callable = policy.replace("static let callable: Set<String> = []", 'static let callable: Set<String> = ["Console"]');
  assert.notEqual(callable, policy);
  assert.deepEqual(policySet(callable, "callable"), ["Console"]);
});
