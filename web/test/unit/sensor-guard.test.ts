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

  it("no write call, control-point name or UUID, or bluetooth", () => {
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
    ["full-width hex", "const U = 0x00002ad9;", "control-point UUID"],
    ["SC control point, lower case", 'getCharacteristic("2a55")', "control-point UUID"],
    ["power control point, 128-bit", '"00002A66-0000-1000-8000-00805f9b34fb"', "control-point UUID"],
    ["decimal FTMS", "getCharacteristic(10969)", "control-point UUID"],
    ["decimal SC", "const u = 10837;", "control-point UUID"],
    ["decimal power", "const u = 10854;", "control-point UUID"],
    ["name, FTMS", 'getCharacteristic("fitness_machine_control_point")', "control-point UUID"],
    ["name, SC", '"sc_control_point"', "control-point UUID"],
    ["name, power", '"cycling_power_control_point"', "control-point UUID"],
    ["unlisted characteristic, hex", "0x2A19", "control-point UUID"],
    ["unlisted service, string", '"1814"', "control-point UUID"],
    ["navigator.bluetooth", "navigator.bluetooth.requestDevice({})", "bluetooth"],
    ["optional chain", "navigator?.bluetooth", "bluetooth"],
    ["bracket spelling", 'navigator["bluetooth"]', "bluetooth"],
    ["optional bracket", 'navigator?.["bluetooth"]', "bluetooth"],
    ["destructured", "const { bluetooth } = navigator;", "bluetooth"],
    ["aliased", "const n = navigator; n.bluetooth.getAvailability()", "bluetooth"],
  ];
  for (const [label, src, name] of cases) it(label, () => assert.ok(violations(src).includes(name)));

  it("lets the allowed characteristics through", () => {
    assert.deepEqual(violations("const a = 0x2A37, b = 0x2A5B, c = 0x2A63, d = 0x2AD2, e = 0x180d, f = 0x00002a37;"), []);
    assert.deepEqual(violations('const ms = 8601, y = "2024", k = 7200;'), []);
  });
});
