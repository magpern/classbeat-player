// The iOS rider session (issue #898) held to the live contract: the frame types it passes to the
// page are the ones routing.json delivers to a rider, the examples its XCTests replay are the
// schema's own, and its sources keep the rider token in memory only, naming no storage and no log.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bans, iosText, swiftFiles } from "./ios-sources.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const V1 = join(HERE, "..", "..", "..", "schema", "live", "v1");

type Route = { type: string; schema: string; to: string[] };
const routes = (JSON.parse(readFileSync(join(V1, "routing.json"), "utf8")) as { messages: Route[] }).messages;

const RIDER_SOURCES = [
  "ios/App/App/RiderBridge.swift",
  "ios/App/App/Policy/RiderSession.swift",
  "ios/App/App/Policy/RiderTransport.swift",
  "ios/App/App/Policy/RiderWire.swift",
];

test("the Swift rider types are exactly the messages routing.json delivers to a rider", () => {
  const m = /static let riderTypes: Set<String> = \[([^\]]*)\]/.exec(iosText("ios/App/App/Policy/RiderWire.swift"));
  assert.ok(m, "RiderWire.riderTypes is written as one literal");
  const swift = [...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!).sort();
  const routed = [...new Set(routes.filter((r) => r.to.includes("rider")).map((r) => r.type))].sort();
  assert.deepEqual(swift, routed);
});

test("the examples the XCTests replay are every routed message's valid examples, as the schema has them", () => {
  const ROW = /^ {8}\("([^"]+)", (true|false), #"(.*)"#\),$/;
  const rows = iosText("ios/App/AppTests/RiderExamples.swift")
    .split("\n")
    .filter((l) => l.startsWith('        ("'))
    .map((l) => {
      const m = ROW.exec(l);
      assert.ok(m, `not a row: ${l.slice(0, 60)}`);
      return { name: m[1]!, toRider: m[2] === "true", value: JSON.parse(m[3]!) as unknown };
    });
  const expected = routes.flatMap((r) => {
    const dir = r.schema.replace(/\.schema\.json$/, "");
    return readdirSync(join(V1, "examples", dir, "valid"))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => ({
        name: `${dir}/${f}`,
        toRider: r.to.includes("rider"),
        value: JSON.parse(readFileSync(join(V1, "examples", dir, "valid", f), "utf8")) as unknown,
      }));
  });
  assert.ok(expected.some((e) => e.toRider) && expected.some((e) => !e.toRider));
  assert.deepEqual(rows, expected);
});

const STORES_OR_LOGS = /\b(Keychain\w*|SecItem\w*|kSec\w*|UserDefaults|FileManager|NSKeyedArchiver|print|debugPrint|dump|NSLog|os_log|Logger|OSLog)\b/;

test("the rider sources hold the token in memory only: no storage, file or log API", () => {
  const check = bans(STORES_OR_LOGS);
  for (const path of RIDER_SOURCES) {
    assert.ok(swiftFiles.some((f) => f.path === path), `${path} exists`);
    assert.equal(check(path, iosText(path)), false, path);
  }
  // The check can fail: each banned name, planted in code, is a hit; in a comment it is not.
  for (const name of ["SecItemAdd", "UserDefaults", "FileManager", "print", "NSLog", "os_log", "Logger"]) {
    assert.equal(check("ios/App/App/Planted.swift", `func f() { ${name}(token) }\n`), true, name);
  }
  assert.equal(check("ios/App/App/Planted.swift", "// never print the token\nlet a = 1\n"), false);
});
