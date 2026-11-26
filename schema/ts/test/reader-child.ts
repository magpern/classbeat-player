// Run by reader.test.ts under `node --disallow-code-generation-from-strings`: reads the class
// documents named on the command line with the reader entry and prints the verdicts as JSON.
// Argument "--ajv" runs the Ajv-based checker instead, to show the flag really forbids it.
import { readFileSync } from "node:fs";
import { checkDocument } from "../src/check.ts";
import { checkClassDocument } from "../src/reader.ts";

const args = process.argv.slice(2);
const useAjv = args[0] === "--ajv";
const files = useAjv ? args.slice(1) : args;
const schema = JSON.parse(readFileSync(new URL("../../class-format/v1/class.schema.json", import.meta.url), "utf8"));
const out: Record<string, unknown> = {};
for (const file of files) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  out[file] = useAjv ? checkDocument(schema, doc, "reader") : checkClassDocument(doc);
}
process.stdout.write(JSON.stringify(out));
