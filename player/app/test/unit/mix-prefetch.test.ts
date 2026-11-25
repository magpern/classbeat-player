// Downloading ahead (main/mix/prefetch.ts, ADR 0013 section 3): when the classes sync or the account
// signs in, every mix the synced classes name is downloaded, one at a time, within the cap and
// never pushing out the open class's mix; a download that did not complete is asked again at the
// next sync, a final one is not; a sync with a complete list deletes the mixes no class names.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MIX_DISABLED } from "../../src/core/mix/view.ts";
import type { MixView } from "../../src/core/mix/view.ts";
import type { CacheOutcome } from "../../src/main/mix/mix-cache.ts";
import { createPrefetch } from "../../src/main/mix/prefetch.ts";
import type { NamedMixes } from "../../src/main/sync/service.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const SIGNED_IN: MixView = { ...MIX_DISABLED, state: "signed_in" };

function rig(outcomes: Record<string, CacheOutcome> = {}) {
  let view: MixView = SIGNED_IN;
  let account: string | null = A;
  let listed: readonly string[] = ["mix_2", "mix_1"];
  let named: NamedMixes | null = null;
  let open: string | null = null;
  const log: string[] = [];
  const pending: (() => void)[] = [];
  const who = (a: string): string => (a === A ? "A" : "B");
  const p = createPrefetch({
    cache: {
      download: (a, m, opts) => {
        log.push(`${who(a)} ${m} ${JSON.stringify(opts)}`);
        return new Promise((r) => pending.push(() => r(outcomes[m] ?? "complete")));
      },
      evict: (a, opts) => {
        log.push(`evict ${who(a)} ${JSON.stringify(opts)}`);
        return Promise.resolve(0);
      },
    },
    view: () => view,
    account: () => account,
    listed: () => listed,
    named: () => named,
    open: () => open,
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
    setNamed: (n: NamedMixes | null) => (named = n),
    setOpen: (o: string | null) => (open = o),
  };
}

const ahead = (who: string, m: string, keep: readonly string[], pinned: readonly string[] = []) => `${who} ${m} ${JSON.stringify({ keep, pinned, fit: true })}`;

test("a sync downloads every listed mix, one at a time, each within the cap", async () => {
  const r = rig();
  r.p.synced();
  r.p.synced();
  assert.deepEqual(r.log, [ahead("A", "mix_2", ["mix_2", "mix_1"])], "one waits in the queue at a time");
  await r.settleAll();
  assert.deepEqual(r.log, [ahead("A", "mix_2", ["mix_2", "mix_1"]), ahead("A", "mix_1", ["mix_2", "mix_1"])]);
  r.p.synced();
  assert.equal(r.log.length, 2, "a completed mix is not asked again");
  r.setListed(["mix_1", "mix_2", "mix_3"]);
  r.p.synced();
  assert.equal(r.log.at(-1), ahead("A", "mix_3", ["mix_1", "mix_2", "mix_3"]));
});

test("the open class's mix is pinned in every download ahead", async () => {
  const r = rig();
  r.setOpen("mix_9");
  r.p.synced();
  assert.deepEqual(r.log, [ahead("A", "mix_2", ["mix_2", "mix_1"], ["mix_9"])]);
});

test("a mix that does not fit is skipped, the rest go on, and it is asked again at the next sync", async () => {
  const r = rig({ mix_2: "no_room" });
  r.p.synced();
  await r.settleAll();
  assert.deepEqual(
    r.log.map((l) => l.split(" ")[1]),
    ["mix_2", "mix_1"],
    "skipped, not stopped, and not asked again in the same round",
  );
  r.outcomes.mix_2 = "complete";
  r.p.synced();
  await r.settleAll();
  assert.deepEqual(
    r.log.map((l) => l.split(" ")[1]),
    ["mix_2", "mix_1", "mix_2"],
    "asked again at the next sync; mix_1 completed and is not",
  );
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

test("signing out forgets what was asked: after signing in again every mix is asked", async () => {
  const r = rig();
  r.p.synced();
  await r.settleAll();
  assert.equal(r.log.length, 2);
  r.setView({ ...SIGNED_IN, state: "signed_out" });
  r.p.check();
  r.setView(SIGNED_IN);
  r.p.check();
  await r.settleAll();
  assert.equal(r.log.length, 4);
});

test("a download that did not complete is asked again at the next sync; a final refusal is not", async () => {
  const r = rig({ mix_2: "interrupted", mix_1: "not_found" });
  r.p.synced();
  await r.settleAll();
  assert.deepEqual(r.log, [ahead("A", "mix_2", ["mix_2", "mix_1"])], "a lost connection waits for the next sync");
  r.outcomes.mix_2 = "complete";
  r.p.synced();
  await r.settleAll();
  assert.deepEqual(r.log.slice(1), [ahead("A", "mix_2", ["mix_2", "mix_1"]), ahead("A", "mix_1", ["mix_2", "mix_1"])]);
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
  assert.equal(r.log.at(-1), ahead("B", "mix_2", ["mix_2", "mix_1"]));
});

test("a sync with a complete list deletes the mixes no class names, never the open class's", () => {
  const r = rig();
  r.setOpen("mix_9");
  r.setNamed({ account: A, mixes: ["mix_1", "mix_2"] });
  r.p.synced();
  assert.equal(r.log[0], `evict A ${JSON.stringify({ keep: ["mix_1", "mix_2"], pinned: ["mix_9"], named: ["mix_1", "mix_2"] })}`);
});

test("no list that is not complete, nor another account's, deletes anything", () => {
  const r = rig();
  r.setNamed(null);
  r.p.synced();
  r.setNamed({ account: B, mixes: ["mix_1"] });
  r.p.synced();
  r.setAccount(null);
  r.setNamed({ account: A, mixes: ["mix_1"] });
  r.p.synced();
  assert.deepEqual(
    r.log.filter((l) => l.startsWith("evict")),
    [],
  );
});
