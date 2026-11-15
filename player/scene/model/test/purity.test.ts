// Acceptance 1: the model is pure. Two fences, both tested: the source is scanned for anything but
// sibling imports and I/O names, and the ESLint rule that guards it is shown to fire.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { ESLint } from "eslint";

const SRC = new URL("../src/", import.meta.url);
const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
const BANNED = /\b(window|document|navigator|fetch|XMLHttpRequest|WebSocket|process|require|Buffer|setTimeout|setInterval|requestAnimationFrame|performance|localStorage|globalThis)\b|Math\.random|\bDate\b|\bcrypto\b/;

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("src has files", () => assert.ok(files.length >= 8));

for (const f of files) {
  const text = readFileSync(new URL(f, SRC), "utf8");
  const code = stripComments(text);
  test(`${f}: imports only sibling modules`, () => {
    const specs = [...code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const s of specs) assert.match(s, /^\.\/[A-Za-z0-9-]+\.ts$/, `${f} imports ${s}`);
    assert.doesNotMatch(code, /\brequire\s*\(|\bimport\s*\(/);
  });
  test(`${f}: names no I/O, DOM, clock or randomness`, () => assert.doesNotMatch(code, BANNED));
  test(`${f}: stays a small pure module (150 lines)`, () => assert.ok(text.split("\n").length <= 150));
}

test("the lint rule rejects three.js, DOM, Node I/O and network use in src", async () => {
  const eslint = new ESLint({ cwd: new URL("../", import.meta.url).pathname });
  const bad: [string, string][] = [
    ['import * as THREE from "three";\nexport const a = THREE;', "no-restricted-imports"],
    ['import { readFileSync } from "node:fs";\nexport const a = readFileSync;', "no-restricted-imports"],
    ['import http from "http";\nexport const a = http;', "no-restricted-imports"],
    ['import { x } from "../../app/src/x.ts";\nexport const a = x;', "no-restricted-imports"],
    ["export const a = document.title;", "no-restricted-globals"],
    ['export const a = () => fetch("https://example.invalid");', "no-restricted-globals"],
    ["export const a = crypto;", "no-restricted-globals"],
    ["export const a = new Date();", "no-restricted-globals"],
    ["export const a = Math.random();", "no-restricted-properties"],
  ];
  for (const [src, rule] of bad) {
    const [r] = await eslint.lintText(src, { filePath: new URL("../src/probe.ts", import.meta.url).pathname });
    assert.ok(r!.messages.some((m) => m.ruleId === rule), `not rejected by ${rule}: ${src}`);
  }
  const [ok] = await eslint.lintText('import { a } from "./energy.ts";\nexport const b = a;', { filePath: new URL("../src/probe.ts", import.meta.url).pathname });
  assert.equal(ok!.messages.filter((m) => m.ruleId === "no-restricted-imports").length, 0);
});
