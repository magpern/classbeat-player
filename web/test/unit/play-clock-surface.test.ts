// Guard (ADR 0008, section 4): the web player page takes the class clock from the player lane through
// a shared surface of exactly three files, `clock.ts`, `plan.ts` and `view.ts`. Read from the syntax
// tree, like core-purity.ts does for the companion's core:
// - the play bundle reaches no `player/` file but those three;
// - a file of the surface imports nothing but each other and the generated class-format types, and
//   names no DOM or I/O global;
// - `web/src/room/` still imports nothing from `player/`, and neither does the rest of `web/`.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { build } from "esbuild";
import { WEB_DIR } from "../lib/browser.ts";
import { reach, specifiersOf } from "../lib/play-graph.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { impurities } from "../lib/core-purity.ts";

const REPO = resolve(WEB_DIR, "..");
const CLOCK_DIR = join(REPO, "player", "app", "src", "core", "clock");
/** The shared clock surface: the three exact files. */
export const SURFACE = ["clock.ts", "plan.ts", "view.ts"].map((f) => join(CLOCK_DIR, f));
/** What a file of the surface may name: the others of the three, and the generated class-format types (five levels up to `schema/`). */
const SURFACE_ALLOWED = /^(\.\/(clock|plan|view)\.ts|(\.\.\/){5}schema\/generated\/ts\/class\.d\.ts)$/;

const rel = (f: string): string => relative(REPO, f).split("\\").join("/");
const underPlayer = (f: string): boolean => rel(f).startsWith("player/");

/** The player files a set of reached files includes, other than the surface. */
export function outsideSurface(files: Iterable<string>): string[] {
  return [...files].filter((f) => underPlayer(f) && !SURFACE.includes(f)).map(rel).sort();
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : /\.ts$/.test(name) ? [p] : [];
  });
}

describe("the shared clock surface", () => {
  const play = reach(join(WEB_DIR, "src", "play", "main.ts"));

  it("the play bundle reaches no player file but clock.ts, plan.ts and view.ts", () => {
    assert.deepEqual(outsideSurface(play.files), []);
    assert.deepEqual([], play.computed, "a module named by something that is not a string literal");
    assert.deepEqual(play.unresolved, [], "a relative import that resolves to no file");
  });

  it("the shipped build, as esbuild resolves it, reaches no player file but the three", async () => {
    const result = await build({ absWorkingDir: WEB_DIR, entryPoints: { play: "src/play/main.ts" }, bundle: true, format: "iife", outdir: "unused", write: false, metafile: true, logLevel: "silent" });
    const inputs = Object.keys(result.metafile.inputs).map((f) => resolve(WEB_DIR, f));
    assert.deepEqual(outsideSurface(inputs), []);
    for (const f of SURFACE) assert.ok(inputs.includes(f), rel(f));
  });

  it("the play bundle does take all three, and nothing from player/ in any other way", () => {
    for (const f of SURFACE) assert.ok(play.files.has(f), `${rel(f)} is not reached`);
    assert.deepEqual(play.bare, [], "a package named by the page");
  });

  it("the surface imports only each other and the generated class types, and names no DOM or I/O global", () => {
    for (const f of SURFACE) assert.deepEqual(impurities(f, readFileSync(f, "utf8"), SURFACE_ALLOWED), [], rel(f));
  });

  it("the surface is closed: what it reaches is itself and the class types", () => {
    for (const f of SURFACE) {
      const files = [...reach(f).files].filter((x) => x.endsWith(".ts") && !x.endsWith(".d.ts"));
      assert.deepEqual(files.filter((x) => !SURFACE.includes(x)).map(rel), [], rel(f));
    }
  });

  it("web/src/room and the rest of web/src import nothing from player/ (the play bundle is the one place)", () => {
    const bad: string[] = [];
    for (const f of sources(join(WEB_DIR, "src")).filter((x) => !x.startsWith(join(WEB_DIR, "src", "play")))) {
      for (const spec of specifiersOf(f, readFileSync(f, "utf8"))) if (spec === null || /(^|\/)player(\/|$)/.test(spec)) bad.push(`${rel(f)} names ${spec}`);
    }
    assert.deepEqual(bad, []);
  });
});

describe("the graph walk resolves as the bundler does and fails closed", () => {
  const PLAYER = join(CLOCK_DIR, "..", "room", "keys.ts");
  function tree(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "play-graph-"));
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), text.replace("@P@", relative(join(dir, name, ".."), PLAYER).split("\\").join("/")));
    }
    return join(dir, "main.ts");
  }

  it("follows an import without its extension, a side-effect import and a directory import", () => {
    for (const main of ['import "./extra";', 'import { x } from "./extra";', 'export * from "./extra";', 'import "./dir";']) {
      const r = reach(tree({ "main.ts": main, "extra.ts": `import "@P@";`, "dir/index.ts": `import "@P@";` }));
      assert.deepEqual(outsideSurface(r.files), ["player/app/src/core/room/keys.ts"], main);
      assert.deepEqual(r.unresolved, []);
    }
  });

  it("reports a relative import that resolves to no file", () => {
    const r = reach(tree({ "main.ts": 'import "./missing"; import "./gone.ts";' }));
    assert.deepEqual(r.unresolved.map(([, n]) => n), ["./missing", "./gone.ts"]);
  });
});

describe("the surface guard catches what it must", () => {
  it("a player file outside the three is reported", () => {
    const apply = join(CLOCK_DIR, "apply.ts");
    assert.deepEqual(outsideSurface([...SURFACE, apply]), ["player/app/src/core/clock/apply.ts"]);
    assert.deepEqual(outsideSurface([join(REPO, "player", "app", "src", "core", "commands.ts")]), ["player/app/src/core/commands.ts"]);
  });

  it("an import beyond the surface, a package and a DOM or I/O global are reported", () => {
    const bad = (src: string): string[] => impurities("clock.ts", src, SURFACE_ALLOWED);
    assert.deepEqual(bad('import { x } from "./plan.ts";\nimport type { Class } from "../../../../../schema/generated/ts/class.d.ts";'), []);
    assert.deepEqual(bad('import { y } from "./apply.ts";'), ['import "./apply.ts"']);
    assert.deepEqual(bad('import { z } from "../commands.ts";'), ['import "../commands.ts"']);
    assert.deepEqual(bad('import { w } from "node:fs";'), ['import "node:fs"']);
    assert.deepEqual(bad("export const t = Date.now();"), ["global Date"]);
    assert.deepEqual(bad("export const t = document.title;"), ["global document"]);
    assert.deepEqual(bad("export const t = performance.now();"), ["global performance"]);
  });
});
