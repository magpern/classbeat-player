// Loads the real spike tree for the guard tests: every path, and the text of every file the guard reads.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Tree } from "../src/guard_rules.js";

const SKIP = new Set(["node_modules", ".gradle", ".git"]);
const BINARIES = ["gradle/wrapper/gradle-wrapper.jar"];
const TEXTS = ["gradle.properties", "gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.properties", "app/src/main/AndroidManifest.xml"];
/** Any Kotlin, in any source set, under any directory (#570, N10): not only `src/main`. */
const KOTLIN = /\.kts?$/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (SKIP.has(n)) return [];
    const p = join(dir, n);
    return lstatSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Tracked and untracked-but-not-ignored entries (a committed `build/` directory counts, a Gradle output does not); a plain walk without version control. */
function listPaths(root: string): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
    return out.split("\0").filter(Boolean);
  } catch {
    console.warn("load_tree: version control is not available, falling back to a plain directory walk");
    return walk(root).map((p) => relative(root, p).split("\\").join("/"));
  }
}

export function loadTree(root: string): Tree {
  const paths: string[] = [];
  const special: string[] = [];
  for (const p of listPaths(root)) {
    const st = lstatSync(join(root, p), { throwIfNoEntry: false });
    if (!st) continue; // tracked but deleted in the working tree
    paths.push(p);
    // Anything that is not a regular file (a symlink of any kind, a submodule) hides what is behind it: refused by the guard.
    if (!st.isFile()) special.push(p);
  }
  const files: Record<string, string> = {};
  for (const p of paths) if (!special.includes(p) && (KOTLIN.test(p) || TEXTS.includes(p))) files[p] = readFileSync(join(root, p), "utf8");
  const hashes: Record<string, string> = {};
  for (const p of BINARIES) {
    try { hashes[p] = createHash("sha256").update(readFileSync(join(root, p))).digest("hex"); } catch { /* missing or unreadable: the guard reports it */ }
  }
  return { files, paths, hashes, special };
}
