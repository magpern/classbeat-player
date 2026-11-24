// Guard (ADR 0012, section 5; issue #686): no shipped player bundle of the desktop app holds Bluetooth
// code. Every build of build-config.mjs (the list build.mjs runs) is made in memory with a metafile,
// and the scan reads its module list, the text of every output and the numbers in our own sources
// (bt-bundle-scan.ts, shared with the phone app's test). Nothing reads dist/, so no other test races
// build.mjs, and nothing depends on esbuild's path comments, so it still holds under minify. The failure
// is shown on real builds of synthetic sources at the end.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, type BuildOptions } from "esbuild";
import { BUILDS } from "../../build-config.mjs";
import { ALLOWED_GATT, bluetoothFindings, buildFindings, type BuildResult } from "./bt-bundle-scan.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function built(extra: Partial<BuildOptions> = {}, options: readonly BuildOptions[] = BUILDS, cwd = APP): Promise<BuildResult[]> {
  return Promise.all(options.map((b) => build({ ...b, ...extra, absWorkingDir: cwd, write: false, metafile: true, logLevel: "silent" }) as Promise<BuildResult>));
}

test("no build of the desktop app holds Bluetooth code, in its modules, output or numbers", async () => {
  const results = await built();
  assert.equal(results.length, 7); // six scripts and the presenter's style sheet (#682), all scanned
  assert.deepEqual(results.flatMap((r) => buildFindings(r, APP)), []);
});

test("the scan holds under minify, and the presenter takes web/src/sensors/core", async () => {
  const results = await built({ minify: true });
  assert.deepEqual(results.flatMap((r) => buildFindings(r, APP)), []);
  const presenter = (await built()).find((r) => Object.keys(r.metafile.inputs).some((i) => i.endsWith("src/renderer/presenter.ts")))!;
  assert.ok(Object.keys(presenter.metafile.inputs).some((i) => i.endsWith("web/src/sensors/core/freshness.ts")), "not vacuous");
});

test("the html pages of the app hold no Bluetooth code", () => {
  for (const page of ["presenter.html", "classlist.html", "room.html"]) assert.deepEqual(bluetoothFindings(page, readFileSync(join(APP, "src", "renderer", page), "utf8")), []);
});

/** Bundles one synthetic module the way the app's presenter is built, and returns what the scan finds. */
async function findingsFor(files: Record<string, string>, entry = "entry.ts", extra: Partial<BuildOptions> = {}): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "bt-guard-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    const [r] = await built({ entryPoints: [entry], outfile: "out.js", ...extra }, [BUILDS[3]!], dir);
    return buildFindings(r!, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the scan fails on a real build of a synthetic bundle, each ban on its own", async () => {
  const cases: [string, string][] = [
    ["Bluetooth", "navigator[" + '"bluetooth"].requestDevice({});'],
    ["requestDevice", "(globalThis as any).x.requestDevice();"],
    ["a GATT write call", "(globalThis as any).c.writeValueWithoutResponse(1);"],
    ["a GATT connection", "(globalThis as any).s.getPrimaryService(1);"],
    ["a control point", "console.log(0x2ad9);"],
    ["a control point", "console.log('Fitness Machine Control Point');"],
    ["an equipment-control opcode", "(globalThis as any).bike.setTargetPower(200);"],
    ["GATT number 0x2a39", "console.log(0x2a39);"],
    ["GATT number 0x1819", "console.log(0x1819);"],
    ["UUID", "console.log('00002a39-0000-1000-8000-00805f9b34fb');"],
  ];
  for (const [label, src] of cases) {
    for (const extra of [{}, { minify: true }]) assert.ok((await findingsFor({ "entry.ts": src }, "entry.ts", extra)).some((f) => f.includes(label)), `${label}: ${src} ${JSON.stringify(extra)}`);
  }
});

test("the scan fails on a Bluetooth module in the module list, though its text is clean", async () => {
  const found = await findingsFor({ "entry.ts": 'import { x } from "./web-bluetooth.ts"; console.log(x);', "web-bluetooth.ts": "export const x = 1;" }, "entry.ts", { minify: true });
  assert.ok(found.some((f) => f.includes("web-bluetooth.ts") && f.includes("module")), found.join("\n"));
});

test("the scan passes the allowed numbers and strings, and a bundle with none", async () => {
  const src = [...ALLOWED_GATT].map((n) => `console.log(0x${n.toString(16)}, "0000${n.toString(16)}-0000-1000-8000-00805f9b34fb");`).join("\n");
  assert.deepEqual(await findingsFor({ "entry.ts": src }), []);
  assert.deepEqual(await findingsFor({ "entry.ts": "console.log(0x1fffff, 0x3000, 8192);" }), []);
});
