// Which mixes a synced list names (core/sync/named-policy.ts), one guard at a time: each case
// breaks exactly one guard of a list that otherwise answers, so removing that guard alone fails
// its case (issue #720, N16). A complete list with no class names no mix; one whose classes name
// no mix stays null (N15).
import assert from "node:assert/strict";
import { test } from "node:test";
import { namedMixes } from "../../src/core/sync/named-policy.ts";
import type { NamedState } from "../../src/core/sync/named-policy.ts";
import type { SyncState } from "../../src/core/sync/sync-model.ts";

const ANN = "a".repeat(64);
const BOB = "b".repeat(64);
const withMix = (id: string): Record<string, unknown> => ({ music: { source: "swedebeat", swedebeat_mix: { id, length_ms: 60_000, offset_ms: 0 } } });
const DOCS = new Map<string, Readonly<Record<string, unknown>>>([
  ["c1", withMix("mix_b")],
  ["c2", withMix("mix_a")],
]);
const HELD = new Map([
  ["c1", "h1"],
  ["c2", "h2"],
]);
const RUN = { id: 2 } as unknown as NonNullable<SyncState["run"]>;

/** A list that answers: synced, idle, read, no wipe, every held class read back. */
const good: NamedState = { account: ANN, status: "synced", run: null, unread: false, lasting: false, wipePending: false, wipeAfterPin: false, held: HELD };

test("named: a complete list answers with its account's mixes", () => {
  assert.deepEqual(namedMixes(good, ANN, () => DOCS), { account: ANN, mixes: ["mix_a", "mix_b"] });
});

const broken: readonly [string, Partial<NamedState>, string | null, ReadonlyMap<string, Readonly<Record<string, unknown>>>][] = [
  ["no cached account", { account: null }, ANN, DOCS],
  ["no cached account and not paired", { account: null }, null, DOCS],
  ["not paired", {}, null, DOCS],
  ["another account's pairing", {}, BOB, DOCS],
  ["not synced", { status: "offline" }, ANN, DOCS],
  ["a sync is running", { run: RUN }, ANN, DOCS],
  ["the cache is not read", { unread: true }, ANN, DOCS],
  ["the cache cannot be read for good", { lasting: true }, ANN, DOCS],
  ["a wipe waits", { wipePending: true }, ANN, DOCS],
  ["a wipe waits for the class to end", { wipeAfterPin: true }, ANN, DOCS],
  ["a held class does not read back", {}, ANN, new Map([["c1", withMix("mix_b")]])],
];

for (const [why, change, paired, docs] of broken) {
  test(`named: null when only ${why}`, () => {
    assert.equal(namedMixes({ ...good, ...change }, paired, () => docs), null);
  });
  // The same guard with no class at all, where no read-back check stands behind it.
  if (docs === DOCS) {
    test(`named: null with no class when only ${why}`, () => {
      assert.equal(namedMixes({ ...good, held: new Map(), ...change }, paired, () => new Map()), null);
    });
  }
}

test("named: a complete list with no class names no mix", () => {
  assert.deepEqual(namedMixes({ ...good, held: new Map() }, ANN, () => new Map()), { account: ANN, mixes: [] });
});

test("named: classes that name no mix are no reason to delete every mix", () => {
  const plain = new Map([
    ["c1", {}],
    ["c2", {}],
  ]);
  assert.equal(namedMixes(good, ANN, () => plain), null);
});

test("named: the classes are read only once every other guard passed", () => {
  let reads = 0;
  namedMixes({ ...good, wipePending: true }, ANN, () => {
    reads++;
    return DOCS;
  });
  assert.equal(reads, 0);
});
