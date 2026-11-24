// Rule 2 guard (ADR 0012, section 1): no write call, no control-point UUID and no
// `navigator.bluetooth` anywhere in web/src. (The rider page's one-file exception comes with its issue.)
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { WEB_DIR } from "../lib/browser.ts";
import { violations } from "../lib/sensor-guard.ts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|js|mjs|html|css)$/.test(n) ? [p] : [];
  });
}

describe("sensor guard over web/src", () => {
  it("finds source files to scan", () => {
    assert.ok(files(join(WEB_DIR, "src")).length > 10);
  });

  it("no write call, control-point UUID or navigator.bluetooth", () => {
    const found = files(join(WEB_DIR, "src")).flatMap((f) => violations(readFileSync(f, "utf8")).map((v) => `${f}: ${v}`));
    assert.deepEqual(found, []);
  });
});

describe("the guard catches each", () => {
  const cases: Array<[string, string, string]> = [
    ["write call", "await c.writeValue(x)", "write call"],
    ["write with response", "c.writeValueWithResponse(x)", "write call"],
    ["write without response", "c.writeValueWithoutResponse(x)", "write call"],
    ["FTMS control point, hex", "const U = 0x2AD9;", "control-point UUID"],
    ["SC control point, lower case", 'getCharacteristic("2a55")', "control-point UUID"],
    ["power control point, 128-bit", '"00002A66-0000-1000-8000-00805f9b34fb"', "control-point UUID"],
    ["navigator.bluetooth", "navigator.bluetooth.requestDevice({})", "navigator.bluetooth"],
    ["optional chain", "navigator?.bluetooth", "navigator.bluetooth"],
    ["bracket spelling", 'navigator["bluetooth"]', "navigator.bluetooth"],
  ];
  for (const [label, src, name] of cases) it(label, () => assert.ok(violations(src).includes(name)));

  it("lets the allowed characteristics through", () => {
    assert.deepEqual(violations("const a = 0x2A37, b = 0x2A5B, c = 0x2A63, d = 0x2AD2;"), []);
  });
});
