// src/lookup.ts is the only way src/ reads by a variable key or index (computed non-literal keys are
// banned by lint), so each guarantee that lets it replace `table[key]` and `list[i]` is pinned here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lookup, nth } from "../src/lookup.ts";

test("lookup returns an own entry, by string or numeric key, and throws on a missing key", () => {
  assert.equal(lookup<"a" | "b", number>({ a: 1, b: 2 }, "b"), 2);
  assert.equal(lookup<1 | 2, string>({ 1: "one", 2: "two" }, 2), "two");
  assert.throws(() => lookup<string, number>({ a: 1 }, "z"), RangeError);
});

test("lookup never returns a prototype member, whatever the key", () => {
  const table = { a: 1 } as Record<string, unknown>;
  for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) assert.throws(() => lookup(table, key), RangeError, key);
});

test("nth reads a non-negative integer index like list[i]", () => {
  assert.equal(nth(["a", "b"], 0), "a");
  assert.equal(nth(["a", "b"], 1), "b");
  assert.equal(nth(["a", "b"], 2), undefined);
  assert.equal(nth([], 0), undefined);
});

test("nth gives undefined for a negative index, where Array.at would count from the end", () => {
  assert.equal(nth(["a", "b"], -1), undefined);
  assert.equal(nth(["a", "b"], -2), undefined);
});
