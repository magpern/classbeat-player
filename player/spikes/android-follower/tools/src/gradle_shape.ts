// The build scripts of the spike, pinned whole. Pure: files and paths in, problems out.
// What the guard relies on is the pin (gradle_pins.ts): each script equals its pinned text. The list of
// forbidden words is a second layer only: it names what a changed line adds, so a failure explains itself.

import { PINNED_SCRIPTS as SCRIPTS } from "./gradle_pins.js";
import { WRAPPER_HASHES, WRAPPER_TEXTS } from "./wrapper_pins.js";

/** Every build input that is pinned as text: the scripts, `gradle.properties` and the wrapper. */
const PINNED_SCRIPTS: Record<string, string> = { ...SCRIPTS, ...WRAPPER_TEXTS };

/** Line endings, trailing spaces and tabs and blank lines do not count; everything else does (no Unicode trimming). */
export const normalizeScript = (text: string): string =>
  text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, "")).filter((l) => l !== "").join("\n");

/** Ways to configure, hook, disable or redirect a task, or to run code around the build (second layer). */
const FORBIDDEN = /\b(?:tasks|getTasks|check|configure|configureEach|whenTaskAdded|whenObjectAdded|doFirst|doLast|actions|getActions|setActions|dependsOn|setDependsOn|finalizedBy|mustRunAfter|shouldRunAfter|subprojects|allprojects|startParameter|getStartParameter|excludedTaskNames|taskGraph|enabled|isEnabled|setEnabled|onlyIf|setOnlyIf|getGradle|afterEvaluate|beforeEvaluate|StopExecutionException|TaskAction|DefaultTask|buildscript|includeBuild|Regex|isNotEmpty)\b|\ball\s*\{|(?<![\w.])gradle\s*\./;

const BUILD_DIRS = /(?:^|\/)(?:buildSrc|build-logic)(?:\/|$)/;
const SCRIPT_FILE = /\.(?:kts|gradle)$/;
const PROPERTIES_FILE = /(?:^|\/)gradle\.properties$/;

/** What a script adds to its pin: its lines that the pin does not have, tested against the forbidden words. */
function addedLineProblem(path: string, text: string): string | null {
  const pinned = new Set((PINNED_SCRIPTS[path] ?? "").split("\n").map((l) => l.trim()));
  for (const line of normalizeScript(text).split("\n")) {
    const hit = pinned.has(line.trim()) ? null : FORBIDDEN.exec(line);
    if (hit) return `\`${hit[0].trim()}\` in the added line \`${line.trim()}\`: the merged-manifest check cannot be disabled, redirected or detached`;
  }
  return null;
}

/** [rule, path, what] for every build script that differs from its pin, and for every script that should not exist. */
export function buildScriptProblems(files: Record<string, string>, paths: string[], hashes: Record<string, string>): [rule: string, path: string, what: string][] {
  const v: [string, string, string][] = [];
  for (const [path, pin] of Object.entries(PINNED_SCRIPTS)) {
    const text = files[path];
    if (text === undefined) { v.push(["build", path, "a pinned build script is missing"]); continue; }
    const added = addedLineProblem(path, text);
    if (added) v.push(["manifest", path, added]);
    const have = normalizeScript(text).split("\n");
    const want = pin.split("\n");
    const at = have.findIndex((l, i) => l !== want[i]);
    if (at >= 0 || have.length !== want.length) v.push(["build", path, `differs from its pinned text (first difference at line ${at >= 0 ? at + 1 : Math.min(have.length, want.length) + 1}): change the pin in tools/src/gradle_pins.ts in the same pull request`]);
  }
  // The wrapper jar is pinned by hash (the loader computes it), and nothing else may sit under gradle/.
  for (const [path, want] of Object.entries(WRAPPER_HASHES)) {
    if (hashes[path] !== want) v.push(["build", path, "is missing, or differs from its pinned SHA-256: change the pin in tools/src/wrapper_pins.ts in the same pull request"]);
  }
  for (const p of paths) {
    if (p.startsWith("tools/")) continue;
    if (p.startsWith("gradle/") && !(p in PINNED_SCRIPTS) && !(p in WRAPPER_HASHES)) { v.push(["build", p, "nothing else may sit under gradle/"]); continue; }
    if (BUILD_DIRS.test(p)) v.push(["build", p, "buildSrc and build-logic (included builds) are not allowed"]);
    else if ((SCRIPT_FILE.test(p) || PROPERTIES_FILE.test(p)) && !(p in PINNED_SCRIPTS)) v.push(["build", p, "a build script or gradle.properties that is not pinned"]);
  }
  return v;
}
