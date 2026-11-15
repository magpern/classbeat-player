// The renderer's fences are an allowlist, and each is shown firing (as model/test/purity.test.ts
// does for the model). The drawing modules may import only the three.js names below; three.js's own
// audio classes and loaders, a beacon, dynamic import, crypto, workers and `.play(` with any
// arguments are rejected by ESLint. Rule 5 is also checked on the camera's state, not on its name.
// A guard is never weakened: adding a name to the allowlist is a reviewed change.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import { feedAt } from "../demo/scenario.ts";
import { RigLoop } from "../src/loop.ts";
import { SceneRig } from "../src/rig.ts";
import { RENDER_DIR, tokensFromFile } from "../tools/tokens-file.ts";

const ALLOWED = ["AdditiveBlending", "CircleGeometry", "Color", "ConeGeometry", "DoubleSide", "Group", "InstancedMesh", "Mesh", "MeshBasicMaterial", "Object3D", "PerspectiveCamera", "PlaneGeometry", "Quaternion", "Scene", "ShaderMaterial", "Vector3", "WebGLRenderer"];
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sources = ["src", "demo"].flatMap((d) => readdirSync(join(RENDER_DIR, d)).filter((f) => f.endsWith(".ts")).map((f) => ({ name: `${d}/${f}`, text: code(readFileSync(join(RENDER_DIR, d, f), "utf8")) })));

test("three.js is imported by allowlisted names only, no subpath, no namespace or default import", () => {
  const used = sources.flatMap((s) => [...s.text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"three"/g)].flatMap((m) => m[1]!.split(",").map((n) => n.trim()).filter(Boolean)));
  assert.ok(used.length > 10);
  assert.deepEqual(used.filter((n) => !ALLOWED.includes(n)), []);
  assert.deepEqual(sources.filter((s) => /from\s*["']three\//.test(s.text) || /import\s+(\*|\w+)[^;]*from\s*"three"/.test(s.text)).map((s) => s.name), []);
});

test("the ESLint config carries the same allowlist", async () => {
  const mod = (await import(pathToFileURL(join(RENDER_DIR, "eslint.config.js")).href)) as { THREE_ALLOWED: string[] };
  assert.deepEqual([...mod.THREE_ALLOWED].sort(), [...ALLOWED].sort());
});

test("each fence fires: three.js audio and loaders, a beacon, dynamic import, crypto, workers, .play(any), cookies, the global object", async () => {
  const eslint = new ESLint({ cwd: RENDER_DIR });
  const bad: [string, string, string][] = [
    ['import { PositionalAudio } from "three";\nexport const a = PositionalAudio;', "no-restricted-imports", "src/probe.ts"],
    ['import { AudioListener, AudioLoader } from "three";\nexport const a = [AudioListener, AudioLoader];', "no-restricted-imports", "src/probe.ts"],
    ['import { TextureLoader } from "three";\nexport const a = new TextureLoader().load("https://example.invalid/x.png");', "no-restricted-imports", "src/probe.ts"],
    ['import { FileLoader } from "three";\nexport const a = FileLoader;', "no-restricted-imports", "demo/probe.ts"],
    ['import * as T from "three";\nexport const a = T;', "no-restricted-syntax", "src/probe.ts"],
    ['import T from "three";\nexport const a = T;', "no-restricted-syntax", "src/probe.ts"],
    ['import { AudioLoader } from "three/src/loaders/AudioLoader.js";\nexport const a = AudioLoader;', "no-restricted-syntax", "src/probe.ts"],
    ['export const a = () => import("https://example.invalid/x.js");', "no-restricted-syntax", "src/probe.ts"],
    ["export const a = (s: { play(n: number): void }) => s.play(0);", "no-restricted-syntax", "src/probe.ts"],
    ['export const a = (s: Record<string, () => void>) => s["play"]();', "no-restricted-syntax", "src/probe.ts"],
    ['export const a = () => navigator.sendBeacon("https://example.invalid", "x");', "no-restricted-globals", "src/probe.ts"],
    ['export const a = (n: { sendBeacon(u: string): void }) => n.sendBeacon("u");', "no-restricted-syntax", "src/probe.ts"],
    ["export const a = () => crypto.getRandomValues(new Uint8Array(4));", "no-restricted-globals", "src/probe.ts"],
    ["export const a = () => globalThis.crypto;", "no-restricted-globals", "src/probe.ts"],
    ['export const a = () => new Worker("w.js");', "no-restricted-globals", "src/probe.ts"],
    ['export const a = () => new Audio("x.mp3");', "no-restricted-globals", "src/probe.ts"],
    ["export const a = () => new Image();", "no-restricted-globals", "src/probe.ts"],
    ['export const a = () => fetch("https://example.invalid");', "no-restricted-globals", "src/probe.ts"],
    ["export const a = (d: { cookie: string }) => d.cookie;", "no-restricted-syntax", "src/probe.ts"],
    ["export const a = Math.random();", "no-restricted-properties", "src/probe.ts"],
    // Plain DOM (the second review's bypass): the document is out of reach of src/, the window only by its allowlist.
    ['export const a = () => document.createElement("audio");', "no-restricted-globals", "src/probe.ts"],
    ["export const a = () => document.body;", "no-restricted-globals", "src/probe.ts"],
    ["export const a = () => new window.Image();", "no-restricted-syntax", "src/probe.ts"],
    ['export const a = () => window["Image"];', "no-restricted-syntax", "src/probe.ts"],
    ['export const a = () => window.open("https://example.invalid");', "no-restricted-syntax", "src/probe.ts"],
    ['export const a = () => window.fetch("https://example.invalid");', "no-restricted-syntax", "src/probe.ts"],
    ["export const a = window;", "no-restricted-syntax", "src/probe.ts"],
    ["export const a = (() => { const w = window; return w; })();", "no-restricted-syntax", "src/probe.ts"],
    ['export const a = () => window.addEventListener("message", () => 0);', "no-restricted-syntax", "src/probe.ts"],
    ["export const a = () => top;", "no-restricted-globals", "src/probe.ts"],
    ['export const a = (e: { src: string }) => { e.src = "https://example.invalid/x.png"; };', "no-restricted-syntax", "src/probe.ts"],
    ['export const a = (e: { srcset: string }) => { e.srcset = "x"; };', "no-restricted-syntax", "src/probe.ts"],
    ['export const a = (e: { href: string }) => { e.href = "x"; };', "no-restricted-syntax", "src/probe.ts"],
    ["export const a = (e: { autoplay: boolean }) => { e.autoplay = true; };", "no-restricted-syntax", "src/probe.ts"],
    ['export const a = (e: { setAttribute(n: string, v: string): void }) => e.setAttribute("src", "x");', "no-restricted-syntax", "src/probe.ts"],
    ["export const a = (e: { appendChild(n: unknown): void }) => e.appendChild({});", "no-restricted-syntax", "src/probe.ts"],
    ['export const a = (e: { innerHTML: string }) => { e.innerHTML = "<audio autoplay>"; };', "no-restricted-syntax", "src/probe.ts"],
    ['export const a = () => document.createElement("audio");', "no-restricted-syntax", "demo/probe.ts"],
    ["export const a = () => document.body;", "no-restricted-syntax", "demo/probe.ts"],
    ["export const a = () => document.head;", "no-restricted-syntax", "demo/probe.ts"],
    ["export const a = () => new window.Image();", "no-restricted-syntax", "demo/probe.ts"],
    ['export const a = () => { location.href = "https://example.invalid"; };', "no-restricted-syntax", "demo/probe.ts"],
    ['export const a = (e: { src: string }) => { e.src = "x"; };', "no-restricted-syntax", "demo/probe.ts"],
    ['import { Color } from "three";\nexport const a = Color;', "no-restricted-imports", "src/loop.ts"],
    ["export const a = performance;", "no-restricted-globals", "src/bursts.ts"],
  ];
  for (const [src, rule, file] of bad) {
    const [r] = await eslint.lintText(src, { filePath: join(RENDER_DIR, file) });
    assert.ok(r!.messages.some((m) => m.ruleId === rule), `not rejected by ${rule}: ${src}`);
  }
  // What each page may still do raises no restriction.
  const allowed: [string, string][] = [
    ["export const a = () => [window.innerWidth, window.innerHeight, window.devicePixelRatio];", "src/probe.ts"],
    ['export const a = () => window.addEventListener("resize", () => 0);', "src/probe.ts"],
    ['export const a = () => [document.getElementById("scene"), document.documentElement, location.search];', "demo/probe.ts"],
  ];
  for (const [src, file] of allowed) {
    const [r] = await eslint.lintText(src, { filePath: join(RENDER_DIR, file) });
    assert.deepEqual(r!.messages.filter((m) => m.ruleId?.startsWith("no-restricted")).map((m) => m.message), [], src);
  }
  const [ok] = await eslint.lintText('import { Color, Mesh } from "three";\nexport const a = [Color, Mesh];', { filePath: join(RENDER_DIR, "src/probe.ts") });
  assert.deepEqual(ok!.messages.map((m) => m.ruleId), []);
});

test("the review's bypass, appended to rig.ts, fails lint (it passed the old blocklist)", async () => {
  const sneak = `import { AudioListener, AudioLoader, PositionalAudio, TextureLoader } from "three";
export function sneak(): void {
  const sound = new PositionalAudio(new AudioListener());
  new AudioLoader().load("https://example.invalid/track.mp3", (b) => { sound.setBuffer(b); sound.play(0); });
  new TextureLoader().load("https://example.invalid/x.png");
  globalThis.crypto.getRandomValues(new Uint8Array(4));
  navigator.sendBeacon("https://example.invalid", "x");
}`;
  const eslint = new ESLint({ cwd: RENDER_DIR });
  const [r] = await eslint.lintText(sneak, { filePath: join(RENDER_DIR, "src/rig.ts") });
  const rules = new Set(r!.messages.map((m) => m.ruleId));
  for (const rule of ["no-restricted-imports", "no-restricted-globals", "no-restricted-syntax"]) assert.ok(rules.has(rule), rule);
  assert.ok(/\bcrypto\b/.test(sneak) && /\.play\s*\(/.test(sneak) && /Loader/.test(sneak) && /sendBeacon/.test(sneak)); // the source layer matches them too
});

test("rule 5, on state: with the camera's own objects frozen, a whole run works, and any move through any alias throws", () => {
  const tokens = tokensFromFile();
  const rig = new SceneRig(tokens);
  const cam = rig.camera;
  for (const o of [cam.position, cam.quaternion, cam.rotation, cam.scale, cam.up]) Object.freeze(o);
  const alias = cam;
  assert.throws(() => alias.position.set(0, 1, 0));
  assert.throws(() => alias.lookAt(3, 3, 3));
  assert.throws(() => alias.rotation.set(1, 0, 0));
  assert.throws(() => { (alias as { position: unknown }).position = cam.position.clone(); });
  const loop = new RigLoop(tokens);
  for (let ms = 0, n = 0; ms < 70_000; n++) {
    const d = loop.step(feedAt(ms), n === 0 ? 0 : 1 / 60, "High");
    rig.apply(d, "High");
    if (n % 400 === 0) rig.setAspect(1.2 + (n % 5) / 5);
    ms += d.dtSeconds * 1000;
  }
});
