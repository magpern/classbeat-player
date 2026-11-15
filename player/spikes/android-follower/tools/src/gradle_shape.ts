// The shape of every Gradle build script in the spike, as an allowlist. Pure: text in, problem out.
// After the exact allowed statements (gradle_pins.ts) and the one check wiring are taken out, nothing
// that configures, reorders, disables or hooks a task may remain, in any script (root and settings too).

import { PINNED } from "./gradle_pins.js";

/** The one wiring of the check to the guarded tasks (the list and its tasks are checked by gradleWiringProblems). */
const WIRING = /tasks\.matching \{ it\.name in \w+ \}\.configureEach \{ dependsOn\(check\) \}/g;

/** Ways to configure, hook, disable or redirect a task, or to run code around the build. None may remain. */
const FORBIDDEN = /\b(?:tasks|check|configure|configureEach|whenTaskAdded|whenObjectAdded|doFirst|doLast|actions|setActions|dependsOn|setDependsOn|finalizedBy|mustRunAfter|shouldRunAfter|subprojects|allprojects|startParameter|excludedTaskNames|taskGraph|enabled|isEnabled|setEnabled|onlyIf|setOnlyIf|afterEvaluate|beforeEvaluate|StopExecutionException|TaskAction|DefaultTask|buildscript|includeBuild)\b|\ball\s*\{|(?<![\w.])gradle\s*\.|(?<!\.)\bapply\b(?!\s+false\b)|\bapply\s*\(/;

const collapse = (s: string) => s.replace(/\s+/g, " ");

/** Null when `kts` holds only allowed statements, else what is left that must not be there. */
export function gradleShapeProblem(path: string, kts: string): string | null {
  let rest = collapse(kts);
  for (const pin of PINNED[path] ?? []) rest = rest.split(pin).join(" ");
  rest = rest.replace(WIRING, " ");
  const left = FORBIDDEN.exec(rest);
  return left ? `${left[0].trim()}: a build script may configure tasks only in the allowed statements (the check cannot be disabled, redirected or detached)` : null;
}
