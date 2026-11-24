// Guard (ADR 0012, issue #663): only the rider web page carries the browser's sensor code. Nothing
// under player/ takes web-bluetooth.ts, directly or through another module: each of the desktop
// app's pages (presenter, class list, room) and each of the Android app's pages (room, rider mode,
// instructor mode) is bundled as it ships, and neither the list of modules esbuild reports
// (its metafile) nor the bundled code names the file or `navigator.bluetooth`. The one module left
// out of the bundles is the Capacitor bridge, which the Android build takes from its own packages.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { build } from "esbuild";
import type { Metafile } from "esbuild";
import { WEB_DIR } from "../lib/browser.ts";

const ROOT = join(WEB_DIR, "..");
const EXTERNAL = ["@capacitor/core"];

const PAGES: readonly { readonly dir: string; readonly entries: readonly string[] }[] = [
  { dir: "player/app", entries: ["src/renderer/presenter.ts", "src/renderer/classlist.ts", "src/renderer/room.ts"] },
  { dir: "player/mobile", entries: ["src/main.ts", "src/rider.ts", "src/instructor.ts"] },
];

interface Bundle {
  readonly inputs: readonly string[];
  readonly externals: readonly string[];
  readonly code: string;
}

async function bundle(dir: string, entry: string): Promise<Bundle> {
  const r = await build({
    absWorkingDir: join(ROOT, dir),
    entryPoints: [entry],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome130",
    outdir: "unused",
    write: false,
    metafile: true,
    logLevel: "silent",
    loader: { ".woff2": "file" },
    external: EXTERNAL,
  });
  const meta: Metafile = r.metafile;
  const externals = new Set<string>();
  for (const i of Object.values(meta.inputs)) for (const imp of i.imports) if (imp.external) externals.add(imp.path);
  const code = r.outputFiles.map((f) => f.text).join("\n");
  return { inputs: Object.keys(meta.inputs), externals: [...externals].sort(), code };
}

const ALL = PAGES.flatMap((p) => p.entries.map((e) => ({ name: `${p.dir}/${e}`, dir: p.dir, entry: e })));
const bundles = new Map<string, Promise<Bundle>>();
const of = (b: (typeof ALL)[number]): Promise<Bundle> => {
  if (!bundles.has(b.name)) bundles.set(b.name, bundle(b.dir, b.entry));
  return bundles.get(b.name)!;
};

describe("the player's bundles carry no browser sensor code", () => {
  for (const b of ALL) {
    it(`${b.name}: no web-bluetooth.ts among its modules or in its code, no navigator.bluetooth`, async () => {
      const x = await of(b);
      assert.ok(x.inputs.length > 3, "the bundle has modules");
      assert.deepEqual(x.inputs.filter((i) => /web-bluetooth/i.test(i)), []);
      assert.doesNotMatch(x.code, /web-bluetooth/i);
      assert.doesNotMatch(x.code, /navigator\s*(\?\.)?\s*(\.\s*bluetooth|\[\s*["'`]bluetooth)/i);
      assert.doesNotMatch(x.code, /requestDevice|startNotifications|getPrimaryService/);
    });
  }

  it("leaves out only the Capacitor bridge, and only from the Android app's pages", async () => {
    const out = new Set<string>();
    for (const b of ALL) for (const e of (await of(b)).externals) out.add(e);
    assert.deepEqual([...out].sort(), EXTERNAL);
    for (const b of ALL.filter((x) => x.dir === "player/app")) assert.deepEqual((await of(b)).externals, [], b.name);
  });

  it("the Android rider page takes the rider page's sensor code with the unavailable source", async () => {
    const x = await of(ALL.find((b) => b.name === "player/mobile/src/rider.ts")!);
    for (const part of ["web/src/rider/sensor-panel.ts", "web/src/sensors/source.ts", "web/src/rider/render/sensors.ts"]) {
      assert.ok(x.inputs.some((i) => i.endsWith(part)), `${part} is not in the bundle`);
    }
    assert.match(x.code, /This browser cannot connect to a sensor/);
  });
});

describe("the guard sees the browser's sensor code where it is", () => {
  it("the rider web page's bundle does take web-bluetooth.ts", async () => {
    const x = await bundle("web", "src/rider/main.ts");
    assert.ok(x.inputs.some((i) => i.endsWith("src/sensors/web-bluetooth.ts")));
    assert.match(x.code, /requestDevice/);
    assert.deepEqual(x.externals, []);
  });
});
