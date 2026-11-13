// The player API's answers (schema/player-api/v1): every example gets its verdict from the JSON
// Schema, and typed literals check the generated TypeScript types (npm run typecheck).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ChangesAnswer } from "../../generated/ts/player-api-changes.d.ts";
import type { CursorAnswer } from "../../generated/ts/player-api-cursor.d.ts";
import type { ErrorBody } from "../../generated/ts/player-api-error.d.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = join(ROOT, "player-api", "v1");
const NAMES = ["changes", "class", "cursor", "error"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const names = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith(".json")).sort();

function validator(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(load(join(ROOT, "class-format", "v1", "class.schema.json")));
  return ajv.compile(load(join(API, `${name}.schema.json`)));
}

for (const name of NAMES) {
  const validate = validator(name);
  for (const kind of ["valid", "invalid"]) {
    const dir = join(API, "examples", name, kind);
    test(`${name} has a ${kind} example`, () => {
      assert.ok(names(dir).length > 0);
    });
    for (const file of names(dir)) {
      test(`${kind} ${name} example: ${file}`, () => {
        assert.equal(validate(load(join(dir, file))), kind === "valid");
      });
    }
  }
}

test("literals of the generated types are valid answers", () => {
  const changes: ChangesAnswer = {
    changes: [
      {
        class_id: "11111111-1111-4111-8111-111111111111",
        source: "classbeat",
        source_class_id: "gone",
        publication_number: 2,
        removed: true,
        content_hash: null,
        published_at: "2026-11-02T10:00:00+00:00",
        position: 2,
      },
    ],
    cursor: 2,
    more: false,
  };
  const cursor: CursorAnswer = { cursor: 2 };
  const error: ErrorBody = { error: "resync_required", cursor: 2 };
  assert.equal(validator("changes")(changes), true);
  assert.equal(validator("cursor")(cursor), true);
  assert.equal(validator("error")(error), true);
});
