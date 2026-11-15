// The fences of guard/ and of what src/ may import (#562, from the review of #557). guard/ names
// prototypes and the render callbacks, which src/ may not, so it has its own fence: the src/ banned
// globals, the three.js allowlist (plus Material) and nothing else of the page. src/ may import three.js
// by the allowlist, its siblings, the scene model and guard/render-callbacks.ts, so it cannot reach tools/.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint } from "eslint";
import { RENDER_DIR } from "../tools/tokens-file.ts";

const eslint = new ESLint({ cwd: RENDER_DIR });
const rulesOf = async (code: string, file: string): Promise<(string | null)[]> => {
  const [r] = await eslint.lintText(code, { filePath: join(RENDER_DIR, file) });
  return r!.messages.map((m) => m.ruleId);
};

test("guard/: a probe that uses AudioLoader, fetch or globalThis fails lint", async () => {
  const bad: [string, string][] = [
    ['import { AudioLoader } from "three";\nexport const a = AudioLoader;', "no-restricted-imports"],
    ['import { TextureLoader } from "three";\nexport const a = TextureLoader;', "no-restricted-imports"],
    ['import { WebGLRenderer } from "three";\nexport const a = WebGLRenderer;', "no-restricted-imports"],
    ['import * as T from "three";\nexport const a = T;', "no-restricted-syntax"],
    ['import { AudioLoader } from "three/src/loaders/AudioLoader.js";\nexport const a = AudioLoader;', "no-restricted-syntax"],
    ['export const a = () => fetch("https://example.invalid");', "no-restricted-globals"],
    ["export const a = () => globalThis;", "no-restricted-globals"],
    ["export const a = () => self;", "no-restricted-globals"],
    ["export const a = () => Function;", "no-restricted-globals"],
    ["export const a = () => new Worker('w.js');", "no-restricted-globals"],
    ["export const a = () => window;", "no-undef"],
    ["export const a = () => document.body;", "no-restricted-globals"],
    ['export const a = () => import("https://example.invalid/x.js");', "no-restricted-syntax"],
    ["export const a = (e: { src: string }) => { e.src = 'x'; };", "no-restricted-syntax"],
    ["export const a = (): unknown => eval('1');", "no-restricted-globals"],
    ['import { x } from "../tools/frame-log.ts";\nexport const a = x;', "no-restricted-imports"],
    ['import { x } from "../src/rig.ts";\nexport const a = x;', "no-restricted-imports"],
    ['import { x } from "node:fs";\nexport const a = x;', "no-restricted-imports"],
  ];
  for (const [src, rule] of bad) assert.ok((await rulesOf(src, "guard/probe.ts")).includes(rule), `guard/ not rejected by ${rule}: ${src}`);
});

test("guard/: it may name prototypes and the callbacks, import its allowlist and use Object reflection, and nothing more", async () => {
  const ok = `import { Material, Mesh, Object3D } from "three";
const names = ["onBeforeRender", "onAfterRender", "onBeforeCompile", "onBeforeShadow", "onAfterShadow"];
export const a = (x: object): unknown => [Mesh.prototype, Object3D.prototype, Object.getPrototypeOf(x), x instanceof Material, names.map((n) => (x as Record<string, unknown>)[n]), Object.freeze({}), Array.isArray(x)];`;
  assert.deepEqual(await rulesOf(ok, "guard/probe.ts"), []);
  // The real file lints clean under its own fence.
  const [real] = await eslint.lintFiles([join(RENDER_DIR, "guard/render-callbacks.ts")]);
  assert.deepEqual(real!.messages.map((m) => `${m.ruleId}: ${m.message}`), []);
});

test("guard/ is in the tsconfig include, so it is type-checked directly", () => {
  const { include } = JSON.parse(readFileSync(join(RENDER_DIR, "tsconfig.json"), "utf8")) as { include: string[] };
  assert.ok(include.includes("guard"), "guard is in include");
  assert.ok(include.includes("src"));
});

test("src/: it cannot import tools/, demo/, test/, another guard/ file, a package or a Node module", async () => {
  const bad = [
    'import { FrameLog } from "../tools/frame-log.ts";',
    'import { tokensFromFile } from "../tools/tokens-file.ts";',
    'import { feedAt } from "../demo/scenario.ts";',
    'import { x } from "../test/lookup.test.ts";',
    'import { x } from "../guard/other.ts";',
    'import { x } from "../guard/render-callbacks.js";',
    'import { x } from "../../model/src/other.ts";',
    'import { x } from "../../../outside.ts";',
    'import { x } from "./sub/deep.ts";',
    'import { x } from "node:fs";',
    'import { x } from "esbuild";',
    'export { x } from "../tools/frame-log.ts";',
    'export * from "../tools/frame-log.ts";',
    'import type { X } from "../tools/frame-log.ts";',
  ];
  for (const line of bad) {
    for (const file of ["src/probe.ts", "src/rig.ts"]) {
      const [r] = await eslint.lintText(`${line}\nexport const a = 1;`, { filePath: join(RENDER_DIR, file) });
      assert.ok(r!.messages.some((m) => m.ruleId === "no-restricted-imports"), `${file} not rejected: ${line}`);
    }
  }
});

test("src/: what it may import still lints clean (three.js by allowlist, siblings, the model, the guard's entry)", async () => {
  const ok = `import { Color } from "three";
import { assertNoRenderCallbacks } from "../guard/render-callbacks.ts";
import { QUALITY } from "../../model/src/index.ts";
import type { Host } from "./host.ts";
import { lookup } from "./lookup.ts";
export const a = [Color, assertNoRenderCallbacks, QUALITY, lookup];
export type B = Host;`;
  assert.deepEqual((await rulesOf(ok, "src/probe.ts")).filter((r) => r === "no-restricted-imports"), []);
});

test("no file of src/ imports from tools/, and the demo entry's renderer.ts is checked by the same fence", async () => {
  const results = await eslint.lintFiles([join(RENDER_DIR, "src")]);
  assert.ok(results.length >= 10);
  assert.deepEqual(results.flatMap((r) => r.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => `${r.filePath}: ${m.message}`)), []);
});

test("the renderer.ts entry (as demo/main.ts uses it) moves none of three's render-callback defaults", () => {
  // A child process loads the entry on its own, the way the page does: every module of src/ runs before
  // the guard's capture matters, and nothing may have changed a callback on any class src/ may build.
  const script = `
    import * as THREE from "three";
    const classes = [THREE.Object3D, THREE.Scene, THREE.Mesh, THREE.InstancedMesh, THREE.Group, THREE.MeshBasicMaterial, THREE.ShaderMaterial];
    const names = ["onBeforeRender", "onAfterRender", "onBeforeCompile", "onBeforeShadow", "onAfterShadow"];
    const snapshot = () => classes.map((c) => names.map((n) => [Object.getPrototypeOf(c.prototype) === null ? null : Object.getOwnPropertyNames(c.prototype).includes(n), c.prototype[n]]));
    const before = snapshot();
    const entry = await import(${JSON.stringify(join(RENDER_DIR, "src/renderer.ts"))});
    const after = snapshot();
    const same = before.every((row, i) => row.every((cell, j) => cell[0] === after[i][j][0] && cell[1] === after[i][j][1]));
    process.stdout.write(JSON.stringify({ same, entry: Object.keys(entry).length }));
  `;
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: RENDER_DIR, encoding: "utf8" });
  const { same, entry } = JSON.parse(out) as { same: boolean; entry: unknown };
  assert.equal(same, true);
  assert.ok(entry, "the entry loaded and exports something");
});
