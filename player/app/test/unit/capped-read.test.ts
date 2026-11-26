// The capped read of the app's own files (main/capped-read.ts): the whole file under the cap, null
// over it, and the buffer sized by the file, not by the cap (#920 review: a 64 MiB cap was
// allocated for every small index).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readCapped } from "../../src/main/capped-read.ts";

const dir = mkdtempSync(join(tmpdir(), "cbp-capped-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("a file at or under the cap is read whole; one byte over is null", () => {
  const f = join(dir, "f");
  writeFileSync(f, "x".repeat(100));
  assert.equal(readCapped(f, 100)?.toString(), "x".repeat(100));
  assert.equal(readCapped(f, 1000)?.length, 100);
  assert.equal(readCapped(f, 99), null);
  writeFileSync(f, "");
  assert.equal(readCapped(f, 10)?.length, 0);
});

test("a cap far larger than any memory is never allocated: the buffer follows the file's size", () => {
  const f = join(dir, "small");
  writeFileSync(f, "small");
  assert.equal(readCapped(f, Number.MAX_SAFE_INTEGER - 1)?.toString(), "small");
});
