// Checks on the Gradle build script text. Pure: text in, problems out.

/** Refuses version catalogs outright: `libs.x` hides the real coordinates from the dependency allowlist. */
export function catalogProblem(kts: string): string | null {
  return /\blibs\b|\bversionCatalogs?\b|\bcatalogs?\b|\.versions\.toml|\.toml\b|\bversionCatalog\w*/i.test(kts)
    ? "a version catalog (libs.*) is not allowed: write each dependency out so the allowlist can check it"
    : null;
}

const count = (text: string, re: RegExp) => [...text.matchAll(re)].length;

/**
 * The merged-manifest check is wired to every guarded task, fail closed: exactly one registered CheckManifest
 * task, exactly one `tasks.matching { it.name in <list> }.configureEach { dependsOn(<check>) }` statement, the
 * list name used nowhere else (no shadowing), and the list a bare `val <list> = listOf("...", ...)` of string
 * literals that ends its statement (no chained `.filter`).
 */
export function gradleWiringProblems(kts: string, tasks: string[]): string[] {
  const checks = [...kts.matchAll(/\bval\s+(\w+)\s*=\s*tasks\.register<CheckManifest>\(/g)];
  if (checks.length !== 1) return [`exactly one CheckManifest task must be registered as a val (found ${checks.length})`];
  const check = checks[0]![1]!;
  const wires = [...kts.matchAll(/tasks\.matching\s*\{\s*it\.name\s+in\s+(\w+)\s*\}\s*\.configureEach\s*\{\s*dependsOn\(\s*(\w+)\s*\)\s*\}/g)];
  if (wires.length !== 1 || wires[0]![2] !== check) return [`exactly one \`tasks.matching { it.name in <list> }.configureEach { dependsOn(${check}) }\` statement is required (found ${wires.length})`];
  const name = wires[0]![1]!;
  if (count(kts, new RegExp(`\\b${name}\\b`, "g")) !== 2) return [`${name} must be declared once and used once, by the wiring statement`];
  const list = new RegExp(`\\bval\\s+${name}\\s*=\\s*listOf\\(\\s*("[^"\\n]*"(?:\\s*,\\s*"[^"\\n]*")*)\\s*\\)[ \\t]*$`, "m").exec(kts);
  if (!list) return [`${name} must be a bare \`listOf("...", ...)\` of string literals that ends its statement`];
  const names = [...list[1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  return tasks.filter((t) => !names.includes(t)).map((t) => `the merged-manifest check is not wired to ${t}`);
}
