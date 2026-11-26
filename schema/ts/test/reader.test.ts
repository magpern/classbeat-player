// The reader-only entry (src/reader.ts) must give the verdicts of checkDocument(..., "reader"),
// use a committed build-time validator that is current, and need no run-time code generation.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readerValidatorSource } from "../scripts/reader-validator-source.ts";
import { checkDocument } from "../src/check.ts";
import { checkClassDocument } from "../src/reader.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const V1 = join(HERE, "..", "..", "class-format", "v1");
const EXAMPLES = join(V1, "examples");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const classSchema = load(join(V1, "class.schema.json"));

// Every class document in the examples: valid, invalid and reader vectors (not expected.json).
const files: string[] = [];
for (const sub of ["valid", "invalid", "reader"]) {
  const dir = join(EXAMPLES, sub);
  for (const n of readdirSync(dir).sort()) if (n.endsWith(".json") && n !== "expected.json") files.push(join(dir, n));
}

test("the table covers valid, invalid and reader vectors", () => {
  assert.ok(files.length > 50, `${files.length} files`);
  for (const sub of ["valid", "invalid", "reader"]) assert.ok(files.some((f) => f.includes(`/${sub}/`)));
});

for (const file of files) {
  test(`same verdict and messages as checkDocument in reader mode: ${file.slice(EXAMPLES.length + 1)}`, () => {
    const doc = load(file);
    assert.deepEqual(checkClassDocument(doc), checkDocument(classSchema, doc, "reader"));
  });
}

test("non-object documents and a prefix match checkDocument too", () => {
  for (const doc of [null, 1, "x", [], {}, { format_version: "2.0" }, { format_version: "1.x" }]) {
    assert.deepEqual(checkClassDocument(doc, "/document"), checkDocument(classSchema, doc, "reader", "/document"));
  }
});

test("the committed generated validator is up to date with the schema", () => {
  const committed = readFileSync(join(SRC, "reader-validator.generated.ts"), "utf8");
  assert.equal(readerValidatorSource(classSchema) === committed, true, "run `npm run build:reader` in schema/ts");
});

test("the up-to-date check notices a schema change", () => {
  const committed = readFileSync(join(SRC, "reader-validator.generated.ts"), "utf8");
  const changed = structuredClone(classSchema);
  changed.$defs.name.maxLength = 79;
  assert.notEqual(readerValidatorSource(changed), committed);
});

const nodeArgs = (...rest: string[]): string[] => ["--disallow-code-generation-from-strings", join(HERE, "reader-child.ts"), ...rest];

test("the reader entry runs with code generation from strings disallowed", () => {
  const out = JSON.parse(execFileSync(process.execPath, nodeArgs(...files), { encoding: "utf8" }));
  for (const file of files) assert.deepEqual(out[file], checkDocument(classSchema, load(file), "reader"), file);
});

test("the flag is real: the Ajv-based checker cannot run under it", () => {
  assert.throws(() => execFileSync(process.execPath, nodeArgs("--ajv", files[0]), { encoding: "utf8", stdio: "pipe" }));
});

// Static pin: every import reachable from reader.ts is another file of src/ (no node:, no package).
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"'\n;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]);
  specs.push(...[...text.matchAll(/\bimport\s*["']([^"']+)["']/g)].map((m) => m[1]));
  specs.push(...[...text.matchAll(/\b(?:require|import)\(\s*["']([^"']+)["']/g)].map((m) => m[1]));
  return specs;
}

test("everything reader.ts imports is a local file, none a node: module or package", () => {
  const seen = new Set<string>();
  const queue = [join(SRC, "reader.ts")];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      assert.ok(spec.startsWith("./"), `${file} imports "${spec}"`);
      queue.push(resolve(dirname(file), spec));
    }
  }
  for (const banned of ["check.ts", "hashing.ts", "index.ts"]) assert.ok(![...seen].some((f) => f.endsWith(`/${banned}`)), banned);
  assert.ok(seen.size >= 6, [...seen].join(" "));
});

test("the generated validator contains no code generation or require", () => {
  const text = readFileSync(join(SRC, "reader-validator.generated.ts"), "utf8");
  assert.doesNotMatch(text, /\brequire\(|new Function|\beval\(/);
});
