// Guard (ADR 0012, section 5; issue #686): no shipped player bundle of the desktop app holds Bluetooth
// code. The test builds the app with its own build script and scans every file in dist/, so a module
// that reaches a bundle by any import is read as the bundle ships it. The scan is in bt-bundle-scan.ts,
// shared with the phone app's test. The failure is shown on synthetic bundles at the end.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ALLOWED_GATT, bluetoothFindings } from "./bt-bundle-scan.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEXT = /\.(?:js|cjs|mjs|html|css|json)$/;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

test("no built bundle of the desktop app holds Bluetooth code", () => {
  execFileSync(process.execPath, ["build.mjs"], { cwd: APP, stdio: "pipe" });
  const dist = join(APP, "dist");
  const files = filesUnder(dist);
  for (const bundle of ["main.cjs", "preload.cjs", "room-preload.cjs", "presenter.js", "classlist.js", "room.js"]) {
    assert.ok(files.some((f) => f.endsWith(bundle)), `${bundle} was not built`);
  }
  const found = files.filter((f) => TEXT.test(f)).flatMap((f) => bluetoothFindings(f.slice(dist.length + 1), readFileSync(f, "utf8")));
  assert.deepEqual(found, []);
});

test("the presenter takes web/src/sensors/core, so the scan is not vacuous", () => {
  const text = readFileSync(join(APP, "dist", "presenter.js"), "utf8");
  assert.match(text, /FRESH_MS/, "the sensor core's freshness rule is in presenter.js");
});

test("the scan fails on a synthetic bundle, each ban on its own", () => {
  const bad: [string, string][] = [
    ["navigator.bluetooth", "(()=>{ navigator.bluetooth.requestDevice({}); })();"],
    ["requestDevice", "const r = o.requestDevice;"],
    ["a GATT write call", "c.writeValueWithoutResponse(b);"],
    ["a GATT write call", "c.writeValue(b)"],
    ["a GATT write call", "d.writeDescriptor(x)"],
    ["a GATT connection", "const s = await server.getPrimaryService(1);"],
    ["a control point", "const CP = 0x2ad9;"],
    ["a control point", "const n = 'Fitness Machine Control Point';"],
    ["an equipment-control opcode", "function setTargetPower(w) {}"],
    ["GATT number", "const S = 0x1819;"],
    ["GATT number", "const C = 0x2a39;"],
    ["UUID", "const u = '00002a39-0000-1000-8000-00805f9b34fb';"],
  ];
  for (const [label, text] of bad) assert.ok(bluetoothFindings("x.js", text).some((f) => f.includes(label)), `${label}: ${text}`);
});

test("the scan passes the allowed numbers and a bundle with none", () => {
  for (const n of ALLOWED_GATT) assert.deepEqual(bluetoothFindings("x.js", `const a = 0x${n.toString(16)}; const u = "0000${n.toString(16)}-0000-1000-8000-00805f9b34fb";`), []);
  assert.deepEqual(bluetoothFindings("x.js", "const x = 0x1fffff; const y = 0x3000; render(heartRate);"), []);
});
