// The live contract's recorded examples (schema/live/v1/examples/<schema>/{valid,invalid}/*.json)
// and enums, read as data. A token's secret is written `<secret43>` in the files and built here at
// load time (schema/live/README.md, choice 11), so no file holds a whole token.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LIVE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schema", "live", "v1");
/** A made-up 43-character secret of the token alphabet; never a real one. */
export const SECRET43 = "Q".repeat(21) + "-" + "q".repeat(21);

export interface Example {
  readonly name: string;
  readonly text: string;
  readonly value: unknown;
}

export function examples(schema: string, kind: "valid" | "invalid"): Example[] {
  const dir = join(LIVE, "examples", schema, kind);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const text = readFileSync(join(dir, f), "utf8").replaceAll("<secret43>", SECRET43);
      return { name: `${schema}/${kind}/${f}`, text, value: JSON.parse(text) as unknown };
    });
}

/** The `enum` at a slash path of a schema, e.g. `properties/reason`. */
export function schemaEnum(schema: string, path: string): unknown[] {
  let node: unknown = JSON.parse(readFileSync(join(LIVE, `${schema}.schema.json`), "utf8"));
  for (const key of path.split("/")) node = (node as Record<string, unknown>)[key];
  const e = (node as { enum?: unknown[] }).enum;
  if (!Array.isArray(e)) throw new Error(`no enum at ${schema}:${path}`);
  return e;
}
