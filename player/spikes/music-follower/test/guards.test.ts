// Rule guards: nothing here reads or records audio, touches the network or holds a credential,
// and the pure core imports no I/O.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}

const srcFiles = sources(join(root, "src"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;

describe("no network, no audio, no credentials", () => {
  it("has only the known build and test dependencies, and no runtime dependencies", () => {
    assert.equal(pkg["dependencies"], undefined);
    assert.deepEqual(Object.keys(pkg["devDependencies"] ?? {}).sort(), ["@types/node", "tsx", "typescript"]);
  });

  it("imports no network or audio module and uses no network call", () => {
    const banned = /(?:from|import|require\()\s*["'](?:node:)?(?:http|https|http2|net|tls|dgram|dns|worker_threads|ws|undici|axios|node-fetch|speaker|node-record-lpcm16|mic|naudiodon|node-web-audio-api|fluent-ffmpeg)["']/;
    const calls = /\b(?:fetch|XMLHttpRequest|WebSocket|getUserMedia|Invoke-WebRequest|Invoke-RestMethod|curl|wget|ffmpeg|arecord|parecord|sox)\b/;
    for (const f of srcFiles) {
      const text = readFileSync(f, "utf8");
      assert.doesNotMatch(text, banned, `${f} imports a banned module`);
      assert.doesNotMatch(text, calls, `${f} uses a banned call`);
    }
  });

  it("holds no token, secret or credential", () => {
    for (const f of srcFiles) assert.doesNotMatch(readFileSync(f, "utf8"), /\b(?:access[_-]?token|client[_-]?secret|api[_-]?key|password|authorization|bearer)\b/i, f);
  });
});

describe("the pure core", () => {
  it("imports only other core modules", () => {
    const core = srcFiles.filter((f) => f.includes(`${join("src", "core")}`));
    assert.ok(core.length >= 5);
    for (const f of core) {
      for (const m of readFileSync(f, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
        assert.match(m[1]!, /^\.\/[\w]+\.js$/, `${f} imports ${m[1]}`);
      }
    }
  });
});
