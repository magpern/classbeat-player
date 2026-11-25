// Downloading ahead (main/mix/prefetch.ts, ADR 0013 section 3): when the classes sync or the account
// signs in, every mix the synced classes name is downloaded, one at a time, keeping them all; a
// download that did not complete is asked again at the next sync, a final one is not.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MIX_DISABLED } from "../../src/core/mix/view.ts";
import type { MixView } from "../../src/core/mix/view.ts";
import type { CacheOutcome } from "../../src/main/mix/mix-cache.ts";
import { createPrefetch } from "../../src/main/mix/prefetch.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const SIGNED_IN: MixView = { ...MIX_DISABLED, state: "signed_in" };

function rig(outcomes: Record<string, CacheOutcome> = {}) {
  let view: MixView = SIGNED_IN;
  let account: string | null = A;
  let listed: readonly string[] = ["mix_2", "mix_1"];
  const log: string[] = [];
  const pending: (() => void)[] = [];
  const p = createPrefetch({
    cache: {
      download: (a, m, keep) => {
        log.push(`${a === A ? "A" : "B"} ${m} ${JSON.stringify(keep)}`);
        return new Promise((r) => pending.push(() => r(outcomes[m] ?? "complete")));
      },
    },
    view: () => view,
    account: () => account,
    listed: () => listed,
  });
  const settleAll = async () => {
    while (pending.length > 0) {
      pending.shift()!();
      await new Promise((r) => setImmediate(r));
    }
  };
  return {
    p,
    outcomes,
    log,
    pending,
    settleAll,
    setView: (v: MixView) => (view = v),
    setAccount: (a: string | null) => (account = a),
    setListed: (l: readonly string[]) => (listed = l),
  };
}

test("a sync downloads every listed mix, one at a time, keeping them all", async () => {
  const r = rig();
  r.p.synced();
  r.p.synced();
  assert.deepEqual(r.log, ['A mix_2 ["mix_1","mix_2"]'], "one waits in the queue at a time");
  await r.settleAll();
  assert.deepEqual(r.log, ['A mix_2 ["mix_1","mix_2"]', 'A mix_1 ["mix_1","mix_2"]']);
  r.p.synced();
  assert.equal(r.log.length, 2, "a completed mix is not asked again");
  r.setListed(["mix_1", "mix_2", "mix_3"]);
  r.p.synced();
  assert.equal(r.log.at(-1), 'A mix_3 ["mix_1","mix_2","mix_3"]');
});

test("nothing downloads while signed out or unpaired; signing in starts it", async () => {
  const r = rig();
  r.setView({ ...SIGNED_IN, state: "signed_out" });
  r.p.check();
  r.p.synced();
  r.setView(SIGNED_IN);
  r.setAccount(null);
  r.p.synced();
  assert.deepEqual(r.log, []);
  r.setAccount(A);
  r.p.check();
  assert.equal(r.log.length, 1, "the sign-in check starts it");
  r.p.check();
  r.p.check();
  await r.settleAll();
  assert.equal(r.log.length, 2);
  r.p.check();
  assert.equal(r.log.length, 2, "check acts only when the account or its sign-in changed");
});

test("a download that did not complete is asked again at the next sync; a final refusal is not", async () => {
  const r = rig({ mix_2: "interrupted", mix_1: "not_found" });
  r.p.synced();
  await r.settleAll();
  assert.deepEqual(r.log, ['A mix_2 ["mix_1","mix_2"]'], "a lost connection waits for the next sync");
  r.outcomes.mix_2 = "complete";
  r.p.synced();
  await r.settleAll();
  assert.deepEqual(r.log.slice(1), ['A mix_2 ["mix_1","mix_2"]', 'A mix_1 ["mix_1","mix_2"]']);
  r.p.synced();
  await r.settleAll();
  assert.equal(r.log.filter((l) => l.startsWith("A mix_1")).length, 1, "not_found is final");
});

test("another account starts afresh", async () => {
  const r = rig();
  r.p.synced();
  await r.settleAll();
  r.setAccount(B);
  r.p.synced();
  assert.equal(r.log.at(-1), 'B mix_2 ["mix_1","mix_2"]');
});
