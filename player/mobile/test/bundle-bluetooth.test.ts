// Guard (ADR 0012, section 5; issue #686): no shipped bundle of the phone app holds Bluetooth code. The
// build is made in memory with the options of build-config.mjs, the ones build.mjs ships with, and its
// module list, every output, the numbers in our own sources and the generated html pages are scanned
// (the scan is the desktop test's). The Capacitor plugins it registers must be the app's two modes or Capacitor's own three.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bluetoothFindings, buildFindings, type BuildResult } from "../../app/test/unit/bt-bundle-scan.ts";
import { buildOptions, ENTRY_POINTS } from "../build-config.mjs";
import { PAGES, pageHtml } from "../src/page.ts";

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), "..");
const make = (extra: Record<string, unknown> = {}): Promise<BuildResult> =>
  build({ ...buildOptions("unused"), ...extra, absWorkingDir: MOBILE, write: false, metafile: true, logLevel: "silent" }) as Promise<BuildResult>;

test("the phone app builds exactly its three entries", () => {
  assert.deepEqual([...ENTRY_POINTS].sort(), ["src/instructor.ts", "src/main.ts", "src/rider.ts"]);
});

test("every bundle of the phone app is free of Bluetooth code, also minified", async () => {
  for (const extra of [{}, { minify: true }]) {
    const r = await make(extra);
    for (const e of ["instructor.js", "main.js", "rider.js"]) assert.ok(r.outputFiles!.some((f) => f.path.endsWith(e)), `${e} was not built`);
    assert.deepEqual(buildFindings(r, MOBILE), []);
  }
});

test("the generated pages hold no Bluetooth code", () => {
  for (const name of Object.keys(PAGES) as (keyof typeof PAGES)[]) assert.deepEqual(bluetoothFindings(name, pageHtml(name)), []);
});

test("a Capacitor plugin that that is not on the list is caught, however it is spelled", () => {
  assert.ok(bluetoothFindings("x.js", 'registerPlugin("BluetoothLe")').length > 0);
  assert.ok(bluetoothFindings("x.js", 'registerPlugin("Sensors")').some((f) => f.includes("plugin")));
  assert.deepEqual(bluetoothFindings("x.js", 'registerPlugin("RiderMode"); registerPlugin("InstructorMode");'), []);
});
