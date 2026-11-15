// Layers 1 and 2 of the page's three fences, in the unit suite (layer 3, the runtime trap, runs in
// the browser run, tools/shots.ts): the lint allowlist rejects the second review's bypass, and the
// demo page carries a content-security policy that closes it off by construction.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint } from "eslint";
import { RENDER_DIR } from "../tools/tokens-file.ts";

const BYPASS = `export function sneak(): void {
  const a = document.createElement("audio");
  a.src = "https://example.invalid/track.mp3";
  a.setAttribute("autoplay", "");
  document.body.appendChild(a);
  const img = new window.Image();
  img.src = "https://example.invalid/x.png";
}`;

test("the second review's bypass (an <audio autoplay> with an https src, an Image with an https src) fails lint in src/ and in demo/", async () => {
  const eslint = new ESLint({ cwd: RENDER_DIR });
  for (const file of ["src/rig.ts", "demo/main.ts"]) {
    const [r] = await eslint.lintText(BYPASS, { filePath: join(RENDER_DIR, file) });
    const hits = r!.messages.filter((m) => m.ruleId?.startsWith("no-restricted"));
    assert.ok(hits.length >= 6, `${file}: only ${hits.length} restrictions fired`);
  }
});

const html = readFileSync(join(RENDER_DIR, "demo", "index.html"), "utf8");
const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
const directives = new Map(policy.split(";").map((d) => d.trim().split(/\s+/)).filter((p) => p[0]).map((p) => [p[0]!, p.slice(1)]));

test("the demo page carries a content-security policy that allows its own files and nothing else", () => {
  const want: Record<string, string[]> = {
    "default-src": ["'none'"], "script-src": ["'self'"], "style-src": ["'self'"], "font-src": ["'self'"],
    "img-src": ["'self'", "data:", "blob:"], "media-src": ["'none'"], "connect-src": ["'none'"], "worker-src": ["'none'"],
    "frame-src": ["'none'"], "object-src": ["'none'"], "base-uri": ["'none'"], "form-action": ["'none'"],
  };
  for (const [name, value] of Object.entries(want)) assert.deepEqual(directives.get(name), value, name);
  assert.deepEqual([...directives.keys()].sort(), Object.keys(want).sort(), "no other directive");
  assert.doesNotMatch(policy, /unsafe-|https?:|\*/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)|\sstyle=|<style|\son\w+=/i); // no inline script, style or handler
});

test("the policy never allows eval, so a Function call throws at run time even if lint misses a route", () => {
  assert.deepEqual(directives.get("script-src"), ["'self'"]);
  assert.doesNotMatch(policy, /unsafe-eval|wasm-unsafe-eval|unsafe-inline/);
});
