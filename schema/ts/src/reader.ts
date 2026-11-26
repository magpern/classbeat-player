// Reader-only entry point: reads and checks a class document the way checkDocument(..., "reader")
// does, for the phone pages, whose CSP has no unsafe-eval. The validator is compiled at build
// time (reader-validator.generated.ts), so nothing here generates code at run time, and nothing
// imports node: modules, Ajv or the content hash. Pure.
import { validate as compiled } from "./reader-validator.generated.ts";
import { violationsFromErrors } from "./schema-errors.ts";
import { checkSemantics } from "./semantic.ts";
import type { Violation } from "./semantic.ts";
import { versionProblem } from "./version.ts";

type Validate = ((doc: unknown) => boolean) & { errors?: readonly { instancePath: string }[] | null };
const validate = compiled as unknown as Validate;

export type { Violation } from "./semantic.ts";

/** All violations of a class document in reader mode; empty means valid. */
export function checkClassDocument(doc: unknown, prefix = ""): Violation[] {
  const version = doc !== null && typeof doc === "object" ? (doc as { format_version?: unknown }).format_version : undefined;
  const problem = versionProblem(version);
  if (problem !== null) return [[problem[0], prefix + problem[1]]];
  if (!validate(doc)) return violationsFromErrors(validate.errors ?? [], prefix);
  return checkSemantics(doc).map(([c, p]) => [c, prefix + p] as Violation);
}
