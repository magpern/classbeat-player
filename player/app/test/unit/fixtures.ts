// Loads the shared example classes and the schema (read-only, from the contract lane).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const SCHEMA_DIR = join(REPO, "schema");
export const EXAMPLES = join(SCHEMA_DIR, "class-format", "v1", "examples");
export const CONVERTER_FIXTURES = join(SCHEMA_DIR, "converter", "fixtures");

export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
export const classSchema = readJson(join(SCHEMA_DIR, "class-format", "v1", "class.schema.json"));
export const loadExample = (rel: string): Class => readJson(join(EXAMPLES, rel)) as Class;

/** The converter's expected documents: example classes from classbeat's data shape (#27). */
export const converterExamples = (): string[] =>
  readdirSync(CONVERTER_FIXTURES)
    .filter((n) => n.endsWith(".expected.json"))
    .sort()
    .map((n) => join(CONVERTER_FIXTURES, n));
