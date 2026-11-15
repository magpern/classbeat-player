// The boundary of src/ is an allowlist: it holds no DOM node and reads no browser global. The host
// (demo/ now, the shell later) builds the three.js renderer and hands over a `Host` (src/host.ts);
// ESLint's `no-undef` in src/ knows only ECMAScript built-ins, so any other global, named or not,
// is an error. Each reviewer bypass of the three rounds is shown failing here, and the allowlist
// of globals is pinned to this file's own copy: widening it is a reviewed change.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import globalsPackage from "globals";
import { RENDER_DIR } from "../tools/tokens-file.ts";

// The ES built-in values src/ may name (everything else in `globals.builtin` is restricted) and TS utility types.
const BUILTINS = [
  "Object", "Array", "Number", "String", "Boolean", "Math", "JSON", "Error", "TypeError", "RangeError", "Map", "Set",
  "parseFloat", "parseInt", "isNaN", "isFinite", "Infinity", "NaN", "undefined",
];
const TYPES = [
  "Readonly", "ReadonlyArray", "ReadonlyMap", "ReadonlySet", "Record", "Pick", "Omit", "Partial", "Required", "ReturnType", "Parameters",
  "NonNullable", "Exclude", "Extract", "Awaited", "Iterable", "ArrayLike",
];
const GLOBALS = [...BUILTINS, ...TYPES];
const OBJECT_MEMBERS = ["entries", "fromEntries", "keys", "values", "freeze"];
interface Config { SRC_GLOBALS: string[]; SRC_BUILTINS: string[]; SRC_BUILTINS_RESTRICTED: string[]; OBJECT_MEMBERS_ALLOWED: string[] }


test("the globals src/ may name are exactly this list (ES built-ins and utility types, no browser global)", async () => {
  const mod = (await import(pathToFileURL(join(RENDER_DIR, "eslint.config.js")).href)) as Config;
  assert.deepEqual([...mod.SRC_GLOBALS].sort(), [...GLOBALS].sort());
  const browser = ["Function", "Reflect", "Proxy", "Date", "eval", "WebAssembly", "Function", "window", "document", "navigator", "fetch", "Image", "Audio", "Range", "FontFace", "speechSynthesis", "SpeechSynthesisUtterance", "globalThis", "self", "location", "performance", "requestAnimationFrame", "setTimeout", "console", "HTMLCanvasElement", "Date", "crypto"];
  assert.deepEqual(browser.filter((n) => GLOBALS.includes(n)), []);
});

test("the restricted ES built-ins are exactly ESLint's own built-in set minus the pinned allowlist, and Object is limited to its pinned members", async () => {
  const mod = (await import(pathToFileURL(join(RENDER_DIR, "eslint.config.js")).href)) as Config;
  const builtin = Object.keys(globalsPackage.builtin);
  assert.deepEqual([...mod.SRC_BUILTINS].sort(), [...BUILTINS].sort());
  assert.deepEqual([...mod.SRC_BUILTINS_RESTRICTED].sort(), builtin.filter((n) => !BUILTINS.includes(n)).sort());
  for (const n of ["Function", "Reflect", "Proxy", "globalThis", "eval", "Date", "Intl", "WeakRef", "Atomics", "SharedArrayBuffer"]) assert.ok(mod.SRC_BUILTINS_RESTRICTED.includes(n), n);
  assert.deepEqual([...mod.OBJECT_MEMBERS_ALLOWED].sort(), [...OBJECT_MEMBERS].sort());
});

const eslint = new ESLint({ cwd: RENDER_DIR });
const lint = async (text: string, file = "src/probe.ts") => (await eslint.lintText(text, { filePath: join(RENDER_DIR, file) }))[0]!.messages;

const CASES: [string, string][] = [
  ["speechSynthesis (rule 10)", "export const a = () => speechSynthesis.speak(new SpeechSynthesisUtterance('go'));"],
  ["SpeechSynthesisUtterance", "export const a = () => new SpeechSynthesisUtterance('go');"],
  ["Range (the third review)", "export const a = () => new Range().createContextualFragment('<img src=https://example.invalid/x.png>');"],
  ["FontFace (the third review)", "export const a = () => new FontFace('f', 'url(https://example.invalid/f.woff2)').load();"],
  ["canvas.style (the third review)", "export const a = (canvas: { style: { backgroundImage: string } }) => { canvas.style.backgroundImage = 'url(https://example.invalid/x.png)'; };\nexport const b = () => canvas.style;"],
  ["a canvas src/ cannot obtain", "export const a = () => canvas.after(null);"],
  ["document", "export const a = () => document.createElement('audio');"],
  ["window", "export const a = () => window.innerWidth;"],
  ["navigator", "export const a = () => navigator.sendBeacon('https://example.invalid', 'x');"],
  ["fetch", "export const a = () => fetch('https://example.invalid');"],
  ["Image", "export const a = () => new Image();"],
  ["Audio", "export const a = () => new Audio('https://example.invalid/a.mp3');"],
  ["globalThis", "export const a = () => globalThis.crypto;"],
  ["self", "export const a = () => self;"],
  ["location", "export const a = () => location.href;"],
  ["requestAnimationFrame", "export const a = () => requestAnimationFrame(() => 0);"],
  ["setTimeout", "export const a = () => setTimeout(() => 0, 1);"],
  ["console", "export const a = () => console.log('x');"],
  ["a DOM type", "export const a = (c: HTMLCanvasElement) => c;"],
  ["XMLHttpRequest", "export const a = () => new XMLHttpRequest();"],
  ["WebSocket", "export const a = () => new WebSocket('wss://example.invalid');"],
  ["AudioContext", "export const a = () => new AudioContext();"],
];
for (const [what, src] of CASES) {
  test(`src/ rejects ${what}`, async () => {
    const m = await lint(src);
    // ESLint treats `globalThis` as a built-in, so the named ban catches it.
    const rule = what === "globalThis" ? "no-restricted-globals" : "no-undef";
    assert.ok(m.some((x) => x.ruleId === rule), `${rule} did not fire on ${what}: ${JSON.stringify(m.map((x) => x.ruleId))}`);
  });
}

test("the reviewers' bypasses of all three rounds fail lint in every file of src/", async () => {
  const bypass = `import { AudioListener, AudioLoader, PositionalAudio, TextureLoader } from "three";
export function sneak(canvas: unknown): void {
  const sound = new PositionalAudio(new AudioListener());
  new AudioLoader().load("https://example.invalid/track.mp3", (b) => { sound.setBuffer(b); sound.play(0); });
  new TextureLoader().load("https://example.invalid/x.png");
  globalThis.crypto.getRandomValues(new Uint8Array(4));
  navigator.sendBeacon("https://example.invalid", "x");
  const a = document.createElement("audio");
  a.src = "https://example.invalid/track.mp3";
  document.body.appendChild(a);
  new window.Image().src = "https://example.invalid/x.png";
  new Range().createContextualFragment("<img src=https://example.invalid/x.png>");
  speechSynthesis.speak(new SpeechSynthesisUtterance("go"));
  new FontFace("f", "url(https://example.invalid/f.woff2)").load();
}`;
  for (const f of readdirSync(join(RENDER_DIR, "src")).filter((n) => n.endsWith(".ts"))) {
    const m = await lint(bypass, `src/${f}`);
    const rules = new Set(m.map((x) => x.ruleId));
    assert.ok(rules.has("no-undef") && rules.has("no-restricted-imports"), `${f}: ${[...rules]}`);
    assert.ok(m.filter((x) => x.ruleId === "no-undef").length >= 8, `${f}: only ${m.filter((x) => x.ruleId === "no-undef").length} undefined globals`);
  }
});

test("what src/ may use still passes: built-ins, utility types, three.js allowlist names, sibling and model imports", async () => {
  const m = await lint('import { Color } from "three";\nimport type { Host } from "./host.ts";\nexport const a = (h: Readonly<Host>, n: number): number => Math.max(0, Number(n)) + (h ? 1 : 0) + new Color().r;\nexport const b = new Map<string, Record<string, number>>();');
  assert.deepEqual(m.map((x) => `${x.ruleId}: ${x.message}`), []);
});

test("no file in src/ imports or names a DOM node, and the host's contract is types only", () => {
  const dir = join(RENDER_DIR, "src");
  const host = readFileSync(join(dir, "host.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(host, /\bfunction\b|=>\s*\{|\bnew\b|\bclass\b/);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    const text = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(text, /\b(HTMLCanvasElement|HTMLElement|canvas|window|document)\b/, f);
  }
  assert.ok(dirname(dir).endsWith("render"));
});
