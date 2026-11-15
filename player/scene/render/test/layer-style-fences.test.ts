// Each fence of layer/ that keeps a style, a member or a string out of the text layer has a test that
// fires: a known-bad sample is refused by THAT rule (matched by its own message, so removing the rule
// from eslint.config.js fails the test even if another rule happens to catch the sample) and a good
// sample passes. The fences are: computed keys, destructuring, `.style` outside dom-kit, setProperty
// and cssText, an aliased style, Object.assign on a style, the member allowlist, and dom-kit's own
// bans (a string literal off its list, `+`, a template, join, String.raw, string-typed anything, url
// text in a comment). The three samples of the third review that named a builder are here too.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint } from "eslint";
import { RENDER_DIR } from "../tools/tokens-file.ts";

const eslint = new ESLint({ cwd: RENDER_DIR });
const lint = async (text: string, file: string) => (await eslint.lintText(text, { filePath: join(RENDER_DIR, file) }))[0]!.messages.map((m) => m.message);

const OTHER = "layer/probe.ts";
const KIT = "layer/dom-kit.ts";
const GOOD_OTHER = "export const a = (e: HTMLElement, n: number): void => { e.className = n > 1 ? \"a\" : \"b\"; e.textContent = \"x\"; };";
const GOOD_KIT = `export function f(el: HTMLElement, n: number): void {
  if (!Number.isFinite(n)) throw new RangeError("not a finite number");
  el.style.left = n.toFixed(2).concat("vw");
}`;

interface Fence { readonly rule: string; readonly file: string; readonly message: string; readonly bad: readonly string[]; readonly good: string }
const FENCES: Fence[] = [
  { rule: "no computed key", file: OTHER, message: "dot access only", good: "export const a = (e: { x: number }) => e.x;", bad: [
    'export const a = (e: Record<string, (h: string) => void>) => e["setHTMLUnsafe"]("<img src=x>");',
    'export const a = (e: Record<string, (o: object) => void>) => e["attachShadow"]({ mode: "open" });',
    "export const a = (e: Record<string, number>, k: string) => e[k];", "export const a = (e: number[]) => e[0];"] },
  { rule: "no destructuring", file: OTHER, message: "does not destructure", good: "export const a = (r: HTMLElement) => r.className;", bad: [
    "export const a = (r: HTMLElement) => { const { parentElement } = r; return parentElement; };",
    "export const a = (r: HTMLElement) => { const { previousElementSibling } = r; return previousElementSibling; };",
    "export const a = (r: HTMLElement) => { const { attributes } = r; const [first] = attributes; return first; };",
    "export const a = ({ x }: { x: number }) => x;", "export const a = (l: number[]) => { const [x] = l; return x; };"] },
  { rule: ".style outside dom-kit", file: OTHER, message: "`.style` is touched only in layer/dom-kit.ts", good: GOOD_OTHER, bad: [
    'export const a = (e: HTMLElement) => { e.style.left = "1vw"; };', "export const a = (e: HTMLElement) => e.style.left;",
    "export const a = (e: HTMLElement) => { const s = e.style; return s; };", // an aliased style
    "export const a = (e: HTMLElement) => Object.assign(e.style, { left: 1 });", // Object.assign on a style
    'export const a = (e: HTMLElement) => { e.style.backgroundImage = "linear-gradient(red, blue)"; };',
    // The three samples of the third review (a builder recognised by its name):
    'const stripGradient = (s: string) => s;\nexport const a = (el: HTMLElement) => { el.style.backgroundImage = stripGradient(["u", "rl(//example.invalid/x.png)"].join("")); };',
    'export const c = (el: HTMLElement, stripGradient: (s: string) => string) => { el.style.backgroundImage = stripGradient(`u${"rl(//x)"}`); };',
    'import { setClass as stripGradient } from "./nodes.ts";\nexport const d = (el: HTMLElement) => { el.style.backgroundImage = stripGradient(el, "x"); };'] },
  { rule: "no setProperty or cssText", file: OTHER, message: "No setProperty or cssText", good: GOOD_OTHER, bad: [
    'export const a = (s: { setProperty(n: string, v: string): void }) => s.setProperty("background-image", "x");',
    'export const a = (s: { cssText: string }) => { s.cssText = "x"; };'] },
  { rule: "member allowlist", file: OTHER, message: "allowlist of members", good: GOOD_OTHER, bad: [
    "export const a = (e: HTMLElement) => e.attributes;", "export const a = (e: HTMLElement) => [e.children, e.firstChild, e.nextSibling, e.parentNode];",
    'export const a = (e: { setHTMLUnsafe(h: string): void }) => e.setHTMLUnsafe("<img>");', "export const a = (e: HTMLElement) => e.attachShadow({ mode: \"open\" });",
    "export const a = (e: HTMLElement) => e.replaceChildren();"] },
  { rule: "dom-kit: string literals off its list", file: KIT, message: "no string literal but its listed words", good: GOOD_KIT, bad: [
    'export function f(el: HTMLElement): void { el.style.left = "ur".concat("l(//x)"); }', 'export function f(el: HTMLElement): void { el.style.left = "1vw"; }',
    'export function f(el: HTMLElement): void { el.style.backgroundImage = "linear-gradient(red, blue)"; }'] },
  { rule: "dom-kit: no +", file: KIT, message: "with `+`", good: GOOD_KIT, bad: [
    "export const a = (n: number): number => n + 1;", 'export function f(el: HTMLElement, n: number): void { el.style.left = n.toFixed(2) + "vw"; }',
    'export function f(el: HTMLElement, n: number): void { let s = n.toFixed(2); s += "vw"; el.style.left = s; }'] },
  { rule: "dom-kit: no template literal", file: KIT, message: "no template literal", good: GOOD_KIT, bad: [
    "export function f(el: HTMLElement, n: number): void { el.style.left = `${n}vw`; }", "export const a = (): number => `x`.length;"] },
  { rule: "dom-kit: no join", file: KIT, message: "does not .join", good: GOOD_KIT, bad: ['export const a = (l: number[]): number => l.join("").length;'] },
  { rule: "dom-kit: no String.raw", file: KIT, message: "String.raw", good: GOOD_KIT, bad: ["export const a = (): number => String.raw.length;"] },
  { rule: "dom-kit: no string, any or unknown type", file: KIT, message: "numbers only", good: GOOD_KIT, bad: [
    "export const a = (s: string): number => s.length;", "export const a = (n: number): string => n.toFixed(2);",
    "export const a = (n: any): number => n;", "export const a = (n: unknown): number => Number(n);"] },
  { rule: "dom-kit: no url text in a comment", file: KIT, message: "comments included", good: `// a fixed gradient\n${GOOD_KIT}`, bad: ["// background: url(https://example.invalid/x.png)\nexport const a = 1;", "/* URL( */ export const a = 1;"] },
  { rule: "dom-kit: no url in a literal", file: KIT, message: "No url( in the text layer", good: GOOD_KIT, bad: ['export const a = (): number => "url(x)".length;'] },
];

for (const f of FENCES) {
  test(`fence "${f.rule}": a good sample passes and every bad sample is refused by that rule`, async () => {
    assert.deepEqual(await lint(f.good, f.file), [], "the good sample passes");
    for (const bad of f.bad) {
      const m = await lint(bad, f.file);
      assert.ok(m.some((x) => x.includes(f.message)), `not refused with "${f.message}": ${bad}\n${JSON.stringify(m)}`);
    }
  });
}

test("dom-kit.ts is short enough to read whole, and the same bans hold on the real file", async () => {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(join(RENDER_DIR, "layer", "dom-kit.ts"), "utf8");
  assert.ok(text.split("\n").length <= 150, "under about 150 lines");
  assert.deepEqual(await lint(text, KIT), []);
  assert.doesNotMatch(text, /url\(/i);
});

test("the other layer files do not touch a style: the real ones lint clean and hold no .style", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  for (const name of readdirSync(join(RENDER_DIR, "layer")).filter((n) => n.endsWith(".ts") && n !== "dom-kit.ts")) {
    assert.doesNotMatch(readFileSync(join(RENDER_DIR, "layer", name), "utf8"), /\.style\b|setProperty|cssText/, name);
  }
});

test("a .tsx or .jsx file in layer/ is fenced like a .ts file", async () => {
  assert.ok((await lint('export const a = (e: Record<string, () => void>) => e["x"]();', "layer/probe.tsx")).some((m) => m.includes("dot access only")));
});
