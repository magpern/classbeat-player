// Where the encrypted mix cache may be loaded (ADR 0013 section 3): only by the main process's mix
// modules. Nothing a renderer or the preload loads reaches it, so no cache key, chunk or token can.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { REPO } from "./fixtures.ts";
import { closure, graphOf } from "./import-graph.ts";
import type { Files } from "./import-graph.ts";

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith(".ts") ? [join(d, n)] : []));
const CACHE = /\/(core\/mix\/(cache-crypto|cache-header|cache-layout|eviction-policy)|main\/mix\/(cache-files|cache-entry|mix-download|mix-reader|mix-cache))\.ts$/;

describe("the mix cache's modules", () => {
  const src = join(REPO, "player", "app", "src");
  const files: Files = new Map(walk(src).map((p) => [relative(REPO, p).split("\\").join("/"), readFileSync(p, "utf8")]));
  const graph = graphOf(files);

  it("are imported only from core/mix/ and main/mix/", () => {
    const all = [...files.keys()].filter((p) => CACHE.test(p));
    assert.equal(all.length, 9);
    const outside = [...graph].filter(([p, deps]) => !/\/(core|main)\/mix\//.test(p) && deps.some((q) => CACHE.test(q))).map(([p]) => p);
    assert.deepEqual(outside, []);
  });

  it("are out of reach of every renderer and the preload", () => {
    const pages = [...files.keys()].filter((p) => /\/src\/(preload|renderer)\/[^/]+\.ts$/.test(p));
    assert.ok(pages.length > 2);
    const reached = [...closure(graph, pages)].filter((p) => CACHE.test(p));
    assert.deepEqual(reached, []);
  });
});
