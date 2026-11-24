// No real Swedebeat or gateway host is reachable from code or tests (ADR 0013 section 2, issue 3).
// Three guards, each run on the real tree and shown to fail on a synthetic violation:
//  1. no file under player/ names a host of scripts/provider-guard.txt;
//  2. no file under player/ sets the mix source origin to anything but empty, localhost or 127.0.0.1;
//  3. no mix module or the fake source holds a URL to a non-loopback host (this also covers a private
//     gateway whose host is deliberately not in the list).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { REPO } from "./fixtures.ts";
import { badOrigins, foreignUrls, guardedHosts, namedHosts } from "./mix-guard-scan.ts";

const SKIP = new Set(["node_modules", "dist", "screenshots", ".git"]);
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (SKIP.has(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|mts|js|mjs|cjs|json|html|css|md|sh)$/.test(n) && n !== "package-lock.json" ? [p] : [];
  });
}
// This guard's own scanner and test hold the synthetic violations below, so they are not scanned.
const SELF = new Set(["player/app/test/unit/mix-guards.test.ts", "player/app/test/unit/mix-guard-scan.ts"]);
const files = walk(join(REPO, "player"))
  .map((p) => [relative(REPO, p).split("\\").join("/"), readFileSync(p, "utf8")] as const)
  .filter(([p]) => !SELF.has(p));
const hosts = guardedHosts(readFileSync(join(REPO, "scripts", "provider-guard.txt"), "utf8"));
/** The mix modules and the fake source; mix tests hold negative examples of origins, so they are not here. */
const isMixFile = (p: string): boolean => /\/src\/.*\/mix\//.test(p) || p.endsWith("/fake-mix-source.ts");

describe("no real host from code or tests", () => {
  it("reads the provider list", () => {
    assert.ok(hosts.length > 0);
  });

  it("names no guarded host under player/", () => {
    const hits = files.flatMap(([p, t]) => namedHosts(t, hosts).map((h) => `${p}: ${h}`));
    assert.deepEqual(hits, []);
  });
  it("catches a guarded host (synthetic)", () => {
    assert.deepEqual(namedHosts(`const u = "https://api.${hosts[0]}/x";`, hosts), [hosts[0]]);
    assert.deepEqual(namedHosts(`not${hosts[0]}`, hosts), []);
  });

  it("sets the mix source origin to nothing but empty or loopback under player/", () => {
    const hits = files.flatMap(([p, t]) => badOrigins(t).map((o) => `${p}: ${o}`));
    assert.deepEqual(hits, []);
  });
  it("catches a bad origin (synthetic)", () => {
    assert.deepEqual(badOrigins(`const mixSourceOrigin = "https://mixes.example.invalid";`), ["https://mixes.example.invalid"]);
    assert.deepEqual(badOrigins("MIX_SOURCE_ORIGIN: 'http://10.0.0.5:8080'"), ["http://10.0.0.5:8080"]);
    assert.deepEqual(badOrigins(`{ mixSourceOrigin: "http://localhost.invalid" }`), ["http://localhost.invalid"]);
    assert.deepEqual(badOrigins(`mixSourceOrigin = ""; mixSourceOrigin: "http://127.0.0.1:5000"; mixSourceOrigin = 'http://localhost'`), []);
  });

  it("holds no non-loopback URL in a mix module or the fake source", () => {
    const mix = files.filter(([p]) => isMixFile(p));
    assert.ok(mix.length >= 5, "the mix files are found");
    const hits = mix.flatMap(([p, t]) => foreignUrls(t).map((u) => `${p}: ${u}`));
    assert.deepEqual(hits, []);
  });
  it("catches a foreign URL (synthetic)", () => {
    assert.deepEqual(foreignUrls(`fetch("https://gateway.example.invalid/mix")`), ["https://gateway.example.invalid"]);
    assert.deepEqual(foreignUrls(`http://127.0.0.1:1/ http://localhost/`), []);
  });
});
