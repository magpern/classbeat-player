// A typed literal checks the generated TypeScript types at compile time (npm run typecheck);
// at run time the same literal must pass the validator, so types and schema cannot drift apart.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Class } from "../../generated/ts/class.d.ts";
import type { Publication } from "../../generated/ts/publication.d.ts";
import { checkDocument, checkPublication, contentHash } from "../src/index.ts";

const V1 = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "class-format", "v1");
const schema = (n: string) => JSON.parse(readFileSync(join(V1, n), "utf8"));

const doc: Class = {
  format_version: "1.0",
  class: { title: "Typed", sport: "cycling", length_ms: 60000 },
  music: { source: "none", design_crossfade_ms: 0, song_timing: "missing" },
  zone_scale: [{ zone: 1, name: "Recovery", rpe: [1, 2] }],
  totals: { length_ms: 60000, time_in_zone_ms: { "1": 60000 } },
  intervals: [
    { start_ms: 0, length_ms: 60000, zone: 1, cadence: "beat", position: "seated", cue: "" },
  ],
  songs: [],
};

test("a literal of the generated Class type is a valid document", () => {
  assert.deepEqual(checkDocument(schema("class.schema.json"), doc, "strict"), []);
});

test("a literal of the generated Publication type is a valid publication", () => {
  const pub: Publication = {
    source_class_id: "typed",
    publication_number: 1,
    content_hash: contentHash(doc),
    document: doc,
  };
  assert.deepEqual(
    checkPublication(schema("class.schema.json"), schema("publication.schema.json"), pub, "strict"),
    [],
  );
});
