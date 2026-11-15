// Checks the scene-only tokens in tokens.css against the "Tokens" table of docs/design/scene.md.
// Rows marked "to be built" belong to a later issue: tokens.css need not hold them yet.
export interface SpecRow { readonly names: string[]; readonly value: string; readonly built: boolean }

const SCENE_NAME = /^--(scene|score|pattern)-/;

export function specRows(md: string): SpecRow[] {
  const section = md.split(/^## Tokens$/m)[1]?.split(/^## /m)[0] ?? "";
  return [...section.matchAll(/^\| (`[^|]+`) \| ([^|]+) \|/gm)].map((m) => ({
    names: [...m[1]!.matchAll(/`(--[\w-]+)`/g)].map((n) => n[1]!),
    value: m[2]!.trim(),
    built: !/to be built/i.test(m[2]!),
  }));
}

export function cssSceneTokens(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/^\s*(--(?:scene|score|pattern)-[\w-]+)\s*:\s*([^;]+);/gm)) out.set(m[1]!, m[2]!.trim());
  return out;
}

/** True when every number (with its unit) of the token's value stands in the spec's cell as a whole number. */
export function valueInSpec(value: string, spec: string): boolean {
  const spaced = spec.replace(/(\d)(vh|vw|ms|s|min|deg)\b/g, "$1 $2");
  return [...value.matchAll(/(\d*\.?\d+)\s*([a-z]*)/g)].every((n) => {
    const num = n[1]!.replace(".", "\\.");
    const unit = n[2] === "deg" ? "degrees" : n[2]!;
    return new RegExp(`(^|[^\\d.])${num}(?![\\d.])${unit ? `\\s*${unit}(?![a-z])` : ""}`).test(spaced);
  });
}

/** Problems found: a token with no spec row or a different value, and a built spec row missing from tokens.css. */
export function sceneTokenProblems(css: string, md: string): string[] {
  const rows = specRows(md);
  const tokens = cssSceneTokens(css);
  const problems: string[] = [];
  for (const [name, value] of tokens) {
    const row = rows.find((r) => r.names.includes(name));
    if (!row) problems.push(`${name} has no spec row`);
    else if (!valueInSpec(value, row.value)) problems.push(`${name}: ${value} is not in the spec's "${row.value}"`);
  }
  for (const r of rows) {
    for (const n of r.names) if (r.built && SCENE_NAME.test(n) && !tokens.has(n)) problems.push(`${n} is in the spec but not in tokens.css`);
  }
  return problems;
}
