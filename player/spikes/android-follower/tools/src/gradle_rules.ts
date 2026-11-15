// Checks on the Gradle build script text. Pure: text in, problems out.

/** Refuses version catalogs outright: `libs.x` hides the real coordinates from the dependency allowlist. */
export function catalogProblem(kts: string): string | null {
  return /\blibs\b|\bversionCatalogs?\b|\bcatalogs?\b|\.versions\.toml|\.toml\b|\bversionCatalog\w*/i.test(kts)
    ? "a version catalog (libs.*) is not allowed: write each dependency out so the allowlist can check it"
    : null;
}

/**
 * The merged-manifest check is wired to every guarded task: the tasks are in the list that the one
 * `tasks.matching { it.name in <list> }.configureEach { dependsOn(<check>) }` statement uses, and
 * `<check>` is the registered CheckManifest task.
 */
export function gradleWiringProblems(kts: string, tasks: string[]): string[] {
  const out: string[] = [];
  const check = /\bval\s+(\w+)\s*=\s*tasks\.register<CheckManifest>\(/.exec(kts)?.[1];
  const wires = [...kts.matchAll(/tasks\.matching\s*\{\s*it\.name\s+in\s+(\w+)\s*\}\s*\.configureEach\s*\{\s*dependsOn\(\s*(\w+)\s*\)\s*\}/g)];
  const wire = wires.find((m) => m[2] === check);
  if (!check) out.push("the CheckManifest task is not registered as a val");
  else if (!wire) out.push(`no \`tasks.matching { it.name in <list> }.configureEach { dependsOn(${check}) }\` statement`);
  const list = wire && new RegExp(`\\bval\\s+${wire[1]}\\s*=\\s*listOf\\(([^)]*)\\)`).exec(kts);
  const names = list ? [...list[1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!) : [];
  if (wire && !list) out.push(`the list ${wire[1]} is not a plain \`listOf("...")\``);
  if (wire && list) for (const task of tasks) if (!names.includes(task)) out.push(`the merged-manifest check is not wired to ${task}`);
  return out;
}
