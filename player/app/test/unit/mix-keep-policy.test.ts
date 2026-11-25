// What eviction keeps (core/mix/keep-policy.ts, ADR 0013 section 3): every mix the synced classes
// name, sorted, once each; classes without a Swedebeat mix name none.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mixesNamed } from "../../src/core/mix/keep-policy.ts";

const doc = (music: unknown) => ({ music }) as never;
const sb = (id: string) => doc({ source: "swedebeat", swedebeat_mix: { id, length_ms: 60_000, offset_ms: 0 } });

test("the mixes the synced classes name: sorted, once each, Swedebeat classes only", () => {
  assert.deepEqual(mixesNamed([sb("mix_b"), sb("mix_a"), sb("mix_b"), doc({ source: "spotify" }), doc({ source: "none" })]), ["mix_a", "mix_b"]);
  assert.deepEqual(mixesNamed([]), []);
});
