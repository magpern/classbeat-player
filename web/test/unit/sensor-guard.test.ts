// Rule 2 guard (ADR 0012, section 1): no write call, no UUID off the allowlist and no
// `navigator.bluetooth` anywhere in web/src, except the one file the rider page reads sensors with.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { WEB_DIR } from "../lib/browser.ts";
import { ALLOWED_LIST, BLUETOOTH_ALLOWED, violations } from "../lib/sensor-guard.ts";

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
    const found = files(join(WEB_DIR, "src")).flatMap((f) => {
      const rel = relative(WEB_DIR, f).replace(/\\/g, "/");
      return violations(readFileSync(f, "utf8"), rel).map((v) => `${rel}: ${v}`);
    });
    assert.deepEqual(found, []);
  });

  it("allows the word bluetooth in exactly one file, and that file uses it", () => {
    assert.deepEqual(BLUETOOTH_ALLOWED, ["src/sensors/web-bluetooth.ts"]);
    const using = files(join(WEB_DIR, "src")).filter((f) => /bluetooth/i.test(readFileSync(f, "utf8"))).map((f) => relative(WEB_DIR, f).replace(/\\/g, "/"));
    assert.deepEqual(using, ["src/sensors/web-bluetooth.ts"]);
  });

  it("the allowance is for that file only, and only for the word", () => {
    const src = "navigator.bluetooth.requestDevice({})";
    assert.deepEqual(violations(src, "src/sensors/web-bluetooth.ts"), []);
    for (const other of ["src/rider/app.ts", "src/sensors/web-bluetooth.js", "x/src/sensors/web-bluetooth.ts", "src/sensors/core/web-bluetooth.ts", ""]) {
      assert.deepEqual(violations(src, other), ["bluetooth"], other);
    }
    assert.deepEqual(violations("c.writeValue(x); const u = 0x2AD9;", "src/sensors/web-bluetooth.ts"), ["write call", "control-point UUID"]);
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
    ["unlisted service, string", '"1815"', "control-point UUID"],
    ["navigator.bluetooth", "navigator.bluetooth.requestDevice({})", "bluetooth"],
    ["optional chain", "navigator?.bluetooth", "bluetooth"],
    ["bracket spelling", 'navigator["bluetooth"]', "bluetooth"],
    ["optional bracket", 'navigator?.["bluetooth"]', "bluetooth"],
    ["destructured", "const { bluetooth } = navigator;", "bluetooth"],
    ["aliased", "const n = navigator; n.bluetooth.getAvailability()", "bluetooth"],
    ["short hex with a leading zero", "const U = 0x02ad9;", "control-point UUID"],
    ["hex with separators", "const U = 0x2a_d9;", "control-point UUID"],
    ["decimal with separators", "const u = 10_969;", "control-point UUID"],
    ["vendor UUID (a trainer's private service)", '"a026e005-0a7d-4ab3-97fa-f1500f9feb8b"', "control-point UUID"],
    ["vendor UART UUID", 'getCharacteristic("6e40fec3-b5a3-f393-e0a9-e50e24dcca9e")', "control-point UUID"],
    ["UUID without dashes", '"6e40fec3b5a3f393e0a9e50e24dcca9e"', "control-point UUID"],
    ["allowed number, wrong base", '"00002a37-0000-1000-8000-00805f9b34fc"', "control-point UUID"],
    ["member 16-bit UUID", "const U = 0xFEC3;", "control-point UUID"],
    ["eight-digit string", '"00002ad9"', "control-point UUID"],
    ["decimal GATT number in a sensor file", "getCharacteristic(10840)", "control-point UUID"],
    ["decimal GATT service in a file that names no sensor", "export const SVC = 6165;", "control-point UUID"],
    ["decimal GATT number with separators, anywhere", "const LENGTH_S = 11_093;", "control-point UUID"],
    ["decimal GATT number that looks like watts", "const watts = 6200;", "control-point UUID"],
  ];
  for (const [label, src, name] of cases) it(label, () => assert.ok(violations(src).includes(name)));

  it("pins the allowlist: the eight of ADR 0012 and exactly 0x1814, 0x2A53 and 0x2ACD (ADR 0015)", () => {
    assert.deepEqual(
      [...ALLOWED_LIST].sort((a, b) => a - b),
      [0x180d, 0x1814, 0x1816, 0x1818, 0x1826, 0x2a37, 0x2a53, 0x2a5b, 0x2a63, 0x2acd, 0x2ad2],
    );
  });

  it("still fails the control points beside the new numbers, and any write", () => {
    const ok = "const a = 0x1814, b = 0x2A53, c = 0x2ACD, d = 6164, e = 10835, f = 10957;";
    assert.deepEqual(violations(ok), []);
    for (const bad of ["0x2AD9", "0x2A55", "10969", "10837", '"2ad9"', '"2a55"', '"00002a55-0000-1000-8000-00805f9b34fb"', '"RSC Control Point"']) {
      assert.deepEqual(violations(`${ok} ${bad}`), ["control-point UUID"], bad);
    }
    assert.deepEqual(violations(`${ok} c.writeValueWithResponse(x)`), ["write call"]);
    assert.deepEqual(violations(`${ok} c.writeValue(x)`), ["write call"]);
  });

  it("lets the allowed characteristics through", () => {
    assert.deepEqual(violations("const a = 0x2A37, b = 0x2A5B, c = 0x2A63, d = 0x2AD2, e = 0x180d, f = 0x00002a37;"), []);
    assert.deepEqual(violations('const ms = 8601, y = "2024", k = 7200;'), []);
    assert.deepEqual(violations('"00002a37-0000-1000-8000-00805f9b34fb"; getCharacteristic(10807); getPrimaryService(6157)'), []);
  });
});
