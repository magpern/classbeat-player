// Rule 3 and rules 5, 8 and 11 as an import graph (#664; ADR 0012 section 4; docs/design/sensors.md
// rule 3 row): no sensor module is imported by the music link, the clock or the shell, and no sensor
// module imports any of them. The only module outside the sensor modules that names one is the
// presenter's entry, which hands the panel its source. A reading therefore cannot reach the music
// link, the timing or a target.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { REPO } from "./fixtures.ts";
import { graphOf, reaches } from "./import-graph.ts";
import type { Files } from "./import-graph.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) ? [p] : [];
  });
}
const rel = (p: string): string => relative(REPO, p).split("\\").join("/");
const load = (...dirs: string[]): Files => new Map(dirs.flatMap((d) => walk(join(REPO, ...d.split("/")))).map((p) => [rel(p), readFileSync(p, "utf8")]));

const isSensor = (p: string): boolean => /^player\/app\/src\/core\/sensors\//.test(p) || /^player\/app\/src\/renderer\/sensors-/.test(p) || /^web\/src\/sensors\//.test(p);
const MUSIC_LINK = [/^player\/app\/src\/core\/link\//, /^player\/app\/src\/main\/(linux-reader|macos-reader|polled-reader|select-music)\.ts$/, /^player\/app\/src\/main\/readers\//];
const isMusicLink = (p: string): boolean => MUSIC_LINK.some((re) => re.test(p));
/** What a reading must never reach or be reached by: the music link, the clock, the shell and its bridge. */
const isTiming = (p: string): boolean => isMusicLink(p) || /^player\/app\/src\/(core\/clock|main|preload)\//.test(p) || p === "player/app/src/core/snapshot.ts" || p === "player/app/src/core/commands.ts";
const ENTRY = "player/app/src/renderer/presenter.ts";

/** The checks, over any set of files (so the test can also run them on a graph that breaks them). */
export function violations(files: Files): string[] {
  const g = graphOf(files);
  const out: string[] = [];
  out.push(...reaches(g, (p) => isTiming(p), isSensor).map((x) => `timing reaches a sensor module: ${x}`));
  out.push(...reaches(g, isSensor, isTiming).map((x) => `a sensor module reaches the timing: ${x}`));
  for (const [p, targets] of g) if (!isSensor(p) && p !== ENTRY && !p.startsWith("player/app/test/") && targets.some(isSensor)) out.push(`${p} imports a sensor module`);
  return out;
}

describe("sensor modules and the music link, the clock and the shell stay apart", () => {
  const files = load("player/app/src", "web/src/sensors");
  it("finds the modules to check", () => {
    assert.ok([...files.keys()].filter(isSensor).length >= 12);
    assert.ok([...files.keys()].filter(isMusicLink).length >= 10);
    assert.ok(files.has(ENTRY));
    assert.ok(graphOf(files).get(ENTRY)!.some(isSensor), "the entry names the panel");
  });
  it("holds for the real code", () => {
    assert.deepEqual(violations(files), []);
  });
  it("fails when the music link imports a sensor module", () => {
    const bad = new Map(files).set("player/app/src/core/link/follow.ts", `import { fresh } from "../sensors/shown.ts";\n${files.get("player/app/src/core/link/follow.ts") ?? ""}`);
    assert.ok(violations(bad).some((v) => v.startsWith("timing reaches a sensor module")), "link -> sensor");
  });
  it("fails when a sensor module imports the music link (directly or through another module)", () => {
    const bad = new Map(files).set("player/app/src/core/sensors/view.ts", `import "../link/view.ts";\n${files.get("player/app/src/core/sensors/view.ts")}`);
    assert.ok(violations(bad).some((v) => v.startsWith("a sensor module reaches the timing")), "sensor -> link");
    const via = new Map(files).set("player/app/src/core/format.ts", `import "./link/view.ts";\n${files.get("player/app/src/core/format.ts")}`).set("player/app/src/core/sensors/plan.ts", `import "../format.ts";\n${files.get("player/app/src/core/sensors/plan.ts")}`);
    assert.ok(violations(via).some((v) => v.startsWith("a sensor module reaches the timing")), "sensor -> format -> link");
  });
  it("fails when the clock or the shell imports a sensor module", () => {
    const clock = new Map(files).set("player/app/src/core/clock/view.ts", `import "../sensors/shown.ts";\n${files.get("player/app/src/core/clock/view.ts")}`);
    assert.ok(violations(clock).length > 0, "clock -> sensor");
    const shell = new Map(files).set("player/app/src/main/controller.ts", `import("../core/sensors/view.ts");\n${files.get("player/app/src/main/controller.ts")}`);
    assert.ok(violations(shell).length > 0, "shell -> sensor (dynamic)");
  });
  it("fails when any other module outside the entry imports a sensor module", () => {
    const bad = new Map(files).set("player/app/src/core/format.ts", `import "./sensors/gauge-calc.ts";\n${files.get("player/app/src/core/format.ts")}`);
    assert.ok(violations(bad).some((v) => v.includes("imports a sensor module")));
  });
  it("type-only imports are not edges (they are erased)", () => {
    const ok = new Map(files).set("player/app/src/core/link/view.ts", `import type { Gauge } from "../sensors/gauge-calc.ts";\n${files.get("player/app/src/core/link/view.ts")}`);
    assert.deepEqual(violations(ok), []);
  });
});
