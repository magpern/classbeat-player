// The text layer (layer/) is the one place that builds DOM nodes, and it is closed like src/ and
// demo/: a node is a `div` or a `span` set by text, class and style; the document is reached only by
// `getElementById` and `createElement`; no markup, no `src`, no link, no attribute setter, no three.js,
// no network, no audio. Each fence is shown firing, and what the layer really does is shown passing.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import { RENDER_DIR } from "../tools/tokens-file.ts";

const eslint = new ESLint({ cwd: RENDER_DIR });
const lint = async (text: string, file = "layer/probe.ts") => (await eslint.lintText(text, { filePath: join(RENDER_DIR, file) }))[0]!.messages;

const BAD: [string, string, string][] = [
  ["an audio element", 'export const a = () => document.createElement("audio");', "no-restricted-syntax"],
  ["an image element", 'export const a = () => document.createElement("img");', "no-restricted-syntax"],
  ["a script element", 'export const a = () => document.createElement("script");', "no-restricted-syntax"],
  ["an iframe", 'export const a = () => document.createElement("iframe");', "no-restricted-syntax"],
  ["a link element", 'export const a = () => document.createElement("link");', "no-restricted-syntax"],
  ["a tag chosen at run time", "export const a = (tag: string) => document.createElement(tag);", "no-restricted-syntax"],
  ["createElementNS", 'export const a = () => document.createElementNS("http://www.w3.org/2000/svg", "svg");', "no-restricted-syntax"],
  ["createElement by a computed key", 'export const a = () => document["createElement"]("div");', "no-restricted-syntax"],
  ["the document's body", "export const a = () => document.body;", "no-restricted-syntax"],
  ["the document's head", "export const a = () => document.head;", "no-restricted-syntax"],
  ["document.cookie", "export const a = () => document.cookie;", "no-restricted-syntax"],
  ["document.write", 'export const a = () => document.write("<audio autoplay src=x>");', "no-restricted-syntax"],
  ["innerHTML", 'export const a = (e: { innerHTML: string }) => { e.innerHTML = "<audio autoplay>"; };', "no-restricted-syntax"],
  ["insertAdjacentHTML", 'export const a = (e: { insertAdjacentHTML(p: string, h: string): void }) => e.insertAdjacentHTML("beforeend", "<img>");', "no-restricted-syntax"],
  ["setAttribute", 'export const a = (e: { setAttribute(n: string, v: string): void }) => e.setAttribute("src", "x");', "no-restricted-syntax"],
  ["a src", 'export const a = (e: { src: string }) => { e.src = "https://example.invalid/x.png"; };', "no-restricted-syntax"],
  ["a href", 'export const a = (e: { href: string }) => { e.href = "https://example.invalid/"; };', "no-restricted-syntax"],
  ["append", "export const a = (e: { append(n: unknown): void }) => e.append({});", "no-restricted-syntax"],
  ["ownerDocument", "export const a = (e: { ownerDocument: unknown }) => e.ownerDocument;", "no-restricted-syntax"],
  ["a member by a computed key", "export const a = (e: Record<string, unknown>, k: string) => e[k];", "no-restricted-syntax"],
  ["constructor", "export const a = (e: { constructor: unknown }) => e.constructor;", "no-restricted-syntax"],
  ["window.open", 'export const a = () => window.open("https://example.invalid");', "no-restricted-syntax"],
  ["window.fetch", 'export const a = () => window.fetch("https://example.invalid");', "no-restricted-syntax"],
  ["a window listener but resize", 'export const a = () => window.addEventListener("message", () => 0);', "no-restricted-syntax"],
  ["fetch", 'export const a = () => fetch("https://example.invalid");', "no-restricted-globals"],
  ["new Image", "export const a = () => new Image();", "no-restricted-globals"],
  ["new Audio", 'export const a = () => new Audio("x.mp3");', "no-restricted-globals"],
  ["a socket", 'export const a = () => new WebSocket("wss://example.invalid");', "no-restricted-globals"],
  ["storage", 'export const a = () => localStorage.setItem("a", "b");', "no-restricted-globals"],
  ["the navigator", 'export const a = () => navigator.sendBeacon("https://example.invalid", "x");', "no-restricted-globals"],
  ["three.js", 'import { Color } from "three";\nexport const a = new Color();', "no-restricted-syntax"],
  ["a three.js subpath", 'import { x } from "three/src/x.js";\nexport const a = x;', "no-restricted-syntax"],
  ["a package", 'import { x } from "left-pad";\nexport const a = x;', "no-restricted-imports"],
  ["a file outside the layer's own and src/", 'import { x } from "../demo/main.ts";\nexport const a = x;', "no-restricted-imports"],
  ["a dynamic import", 'export const a = () => import("https://example.invalid/x.js");', "no-restricted-syntax"],
  ["setHTMLUnsafe", 'export const a = (e: { setHTMLUnsafe(h: string): void }) => e.setHTMLUnsafe("<img src=x>");', "no-restricted-syntax"],
  ["Range.createContextualFragment", 'export const a = (e: HTMLElement) => e.appendChild(new Range().createContextualFragment("<img src=//x>"));', "no-undef"],
  ["createContextualFragment by name", 'export const a = (e: HTMLElement, r: { createContextualFragment(h: string): HTMLElement }) => e.appendChild(r.createContextualFragment("<img>"));', "no-restricted-syntax"],
  ["Document.parseHTMLUnsafe", 'export const a = (e: HTMLElement) => e.appendChild(Document.parseHTMLUnsafe("<img src=//x>").body);', "no-undef"],
  ["a background image url", 'export const a = (e: HTMLElement) => { e.style.backgroundImage = "url(https://example.invalid/x.png)"; };', "no-restricted-syntax"],
  ["a url( in a template", "export const a = (e: HTMLElement, n: string) => { e.style.backgroundImage = `url(${n})`; };", "no-restricted-syntax"],
  ["style.cssText", 'export const a = (e: HTMLElement) => { e.style.cssText = "background:u" + "rl(//x)"; };', "no-restricted-syntax"],
  ["Reflect.construct", 'export const a = () => Reflect.construct(Function, ["return 1"]);', "no-restricted-globals"],
  ["attachShadow", "export const a = (e: { attachShadow(o: object): void }) => e.attachShadow({});", "no-restricted-syntax"],
  ["replaceChildren", "export const a = (e: { replaceChildren(): void }) => e.replaceChildren();", "no-restricted-syntax"],
  ["the scene's canvas by id", 'export const a = () => document.getElementById("scene");', "no-restricted-syntax"],
  ["an id chosen at run time", "export const a = (id: string) => document.getElementById(id);", "no-restricted-syntax"],
  ["a global off the allowlist", "export const a = () => Date.now();", "no-restricted-globals"],
  ["a type off the allowlist", "export const a = (e: HTMLCanvasElement) => e;", "no-undef"],
  ["eval",'export const a = () => eval("1");', "no-eval"],
];
for (const [what, src, rule] of BAD) {
  test(`layer/ rejects ${what}`, async () => {
    const m = await lint(src);
    assert.ok(m.some((x) => x.ruleId === rule), `${rule} did not fire on ${what}: ${JSON.stringify(m.map((x) => x.ruleId))}`);
  });
}

test("what the text layer does still passes: div and span nodes set by text, class and style, found by id, and src/ imports", async () => {
  const m = await lint(`import type { TextView } from "../src/text-view.ts";
import { make } from "./dom-kit.ts";
export function ok(view: TextView, parent: HTMLElement): HTMLElement | null {
  const d = document.createElement("div");
  const s = document.createElement("span");
  d.className = "a"; d.textContent = view.layout; d.style.left = "1vw"; d.hidden = false;
  parent.appendChild(d); d.appendChild(s);
  make(parent, "span", "x");
  return document.getElementById("text");
}
export const grad = (e: HTMLElement) => { e.style.backgroundImage = "linear-gradient(90deg, var(--ink) 0% 50%, transparent 50% 100%)"; };`);
  assert.deepEqual(m.map((x) => `${x.ruleId}: ${x.message}`), []);
});

test("the layer's own files hold only those fences' routes: no network, audio or image names, and the hue is a class, never a colour", () => {
  const dir = join(RENDER_DIR, "layer");
  const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    const text = code(readFileSync(join(dir, f), "utf8"));
    assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|WebSocket|\bAudio\b|\bImage\b|innerHTML|setAttribute|\.src\b|\.href\b|0x[0-9a-f]{6}|#[0-9a-f]{6}\b|rgb\(/i, f);
  }
  const css = readFileSync(join(dir, "text.css"), "utf8");
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|url\(/i, "text.css names no colour of its own and loads nothing: every hue is a token");
});

test("the ESLint config carries the layer's allowlists", async () => {
  const mod = (await import(pathToFileURL(join(RENDER_DIR, "eslint.config.js")).href)) as { LAYER_DOCUMENT_ALLOWED: string[]; LAYER_TAGS: string[]; LAYER_ROOT_ID: string; LAYER_GLOBALS: string[]; LAYER_MEMBERS_ALLOWED: string[] };
  assert.equal(mod.LAYER_ROOT_ID, "text");
  assert.deepEqual(mod.LAYER_GLOBALS.filter((g) => ["document", "window", "HTMLElement"].includes(g)).sort(), ["HTMLElement", "document", "window"]);
  assert.deepEqual(mod.LAYER_GLOBALS.filter((g) => ["Range", "Document", "Reflect", "Function", "Date", "fetch", "HTMLCanvasElement"].includes(g)), []);
  const refused = ["setHTMLUnsafe", "attachShadow", "replaceChildren", "cssText", "createContextualFragment", "parseHTMLUnsafe", "construct", "innerHTML", "src", "append", "setAttribute", "body", "head", "cookie"];
  assert.deepEqual(mod.LAYER_MEMBERS_ALLOWED.filter((m) => refused.includes(m)), []);
  assert.deepEqual([...mod.LAYER_DOCUMENT_ALLOWED].sort(), ["createElement", "getElementById"]);
  assert.deepEqual([...mod.LAYER_TAGS].sort(), ["div", "span"]);
});
