// Guard (ADR 0012, section 5; issue #686): no shipped bundle of the phone app holds Bluetooth code.
// The three entry points (main, rider, instructor) are read from build.mjs itself, so a new entry is
// scanned at once; they are built in memory with the build's own settings and every output file is
// scanned as shipped, together with the module list esbuild reports. The scan is the desktop test's.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bluetoothFindings, bluetoothModules } from "../../app/test/unit/bt-bundle-scan.ts";

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), "..");

function entryPoints(): string[] {
  const m = /entryPoints:\s*\[([^\]]*)\]/.exec(readFileSync(join(MOBILE, "build.mjs"), "utf8"));
  return [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

test("every bundle of the phone app is free of Bluetooth code", async () => {
  const entries = entryPoints();
  assert.deepEqual(entries.sort(), ["src/instructor.ts", "src/main.ts", "src/rider.ts"]);
  const result = await build({
    absWorkingDir: MOBILE, entryPoints: entries, outdir: "unused", write: false, metafile: true, bundle: true,
    logLevel: "silent", legalComments: "none", platform: "browser", format: "iife", target: "chrome130",
    loader: { ".woff2": "file" }, assetNames: "fonts/[name]",
  });
  const js = result.outputFiles.filter((f) => /\.(?:js|css)$/.test(f.path));
  for (const e of ["instructor.js", "main.js", "rider.js"]) assert.ok(js.some((f) => f.path.endsWith(e)), `${e} was not built`);
  const found = [...Object.keys(result.metafile.inputs).flatMap((i) => bluetoothModules([i])), ...js.flatMap((f) => bluetoothFindings(f.path.split(/[\\/]/).pop()!, f.text))];
  assert.deepEqual(found, []);
});
