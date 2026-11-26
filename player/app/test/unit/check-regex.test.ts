// A rule check's regex is neither global nor sticky (issue #870): `test` on such a regex starts where
// the last call left `lastIndex`, so a hit in one view or file could hide a hit in the next.
import assert from "node:assert/strict";
import { test } from "node:test";
import { forbids, fresh } from "./rule-sources.ts";
import { FORBIDDEN, forbidden } from "./rules-ts.ts";

test("why: a global regex misses a hit after the one before it", () => {
  const re = /fetch\(/g;
  assert.equal(re.test("a(); fetch(u);"), true);
  assert.equal(re.test("fetch(u);"), false);
});

test("forbids and forbidden refuse a global or sticky regex, and take any other", () => {
  for (const re of [/fetch\(/g, /fetch\(/y, /fetch\(/gi, /fetch\(/my]) {
    assert.throws(() => fresh(re), /must not be global or sticky/, `${re}`);
    assert.throws(() => forbids(re), /must not be global or sticky/, `forbids ${re}`);
    assert.throws(() => forbidden("x", [["x", re]]), /must not be global or sticky/, `forbidden ${re}`);
  }
  for (const re of [/fetch\(/, /fetch\(/i, /\bfetch\(/m, /fetch\(/su]) {
    assert.equal(fresh(re), re);
    const hit = forbids(re);
    // The same check, file after file: each hit is found.
    assert.deepEqual(["fetch(u);", "a(); fetch(u);", "fetch(u);"].map((t) => hit("x.ts", t)), [true, true, true], `${re}`);
  }
  assert.equal(forbidden("x", [["x", /fetch\(/]])("x.ts", "fetch(u);"), true);
});

test("every forbidden rule builds its check", () => {
  for (const [what] of FORBIDDEN) assert.doesNotThrow(() => forbidden(what), what);
});
