// Class sync's pure model (core/sync/sync-model.ts) before the cache is read: nothing syncs or
// plays until it is, a cache that cannot be read is kept and read again with the fault backoff,
// and a wipe asked meanwhile still comes first.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIRST_BACKOFF_MS } from "../../src/core/sync/backoff-policy.ts";
import { INITIAL, step } from "../../src/core/sync/sync-model.ts";
import type { Credential, Effect, SyncEvent, SyncState } from "../../src/core/sync/sync-model.ts";
import { syncView } from "../../src/core/sync/view.ts";
import { ID_A } from "./sync-fixtures.ts";

const ACCOUNT = "a".repeat(64);
const H1 = `sha256:${"1".repeat(64)}`;
const PAIRED: Credential = { account: ACCOUNT, expired: false };
const NOW = 1000;

/** Drives the model from its first state, with no `loaded` sent. */
function fresh() {
  let state: SyncState = INITIAL;
  return {
    send(e: SyncEvent): readonly Effect[] {
      const out = step(state, e, NOW);
      state = out.state;
      return out.effects;
    },
    get state() {
      return state;
    },
  };
}
const loaded = (wipePending = false): SyncEvent => ({ type: "loaded", account: ACCOUNT, cursor: 4, held: new Map([[ID_A, H1]]), published: new Map(), wipePending });

test("before the cache is read nothing is asked of the server and nothing plays: the cache is read first", () => {
  const r = fresh();
  assert.equal(r.state.unread, true);
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "load" }]);
  assert.deepEqual(r.send({ type: "due", credential: null }), [{ do: "load" }]);
  r.send({ type: "pin", id: ID_A, hash: H1 });
  assert.equal(r.state.pinned, null);
  assert.deepEqual(r.send(loaded()), []);
  assert.equal(r.state.unread, false);
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "list", run: 1, after: 4 }]);
});

test("a cache that cannot be read is kept: sync is unavailable and the read is tried again with the fault backoff", () => {
  const r = fresh();
  // No wipe, no write, no request: only a later wake.
  assert.deepEqual(r.send({ type: "unreadable", lasting: false }), [{ do: "wake", at: NOW + FIRST_BACKOFF_MS }]);
  assert.deepEqual(syncView(r.state), { status: "unavailable", unavailable: "passing", wiping: false, classes: 0, notUpdated: [], pinned: null });
  assert.equal(r.state.wipePending, false);
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "load" }]);
  assert.deepEqual(r.send({ type: "unreadable", lasting: false }), [{ do: "wake", at: NOW + 2 * FIRST_BACKOFF_MS }]);
  // Read at last: held as it is on disk, and synced on from its cursor.
  assert.deepEqual(r.send(loaded()), []);
  assert.deepEqual(syncView(r.state), { status: "unpaired", unavailable: null, wiping: false, classes: 1, notUpdated: [], pinned: null });
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "list", run: 1, after: 4 }]);
  // Once read, a stray fault report changes nothing.
  assert.deepEqual(r.send({ type: "unreadable", lasting: false }), []);
  assert.equal(r.state.status, "syncing");
});

test("a cache shown to need a wipe is wiped, also after a fault reading it", () => {
  const r = fresh();
  r.send({ type: "unreadable", lasting: false });
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "load" }]);
  r.send(loaded(true));
  assert.equal(r.state.held.size, 0);
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "wipe" }]);
});

test("the pairing ending while the cache cannot be read wipes it; once wiped there is nothing left to read", () => {
  const r = fresh();
  r.send({ type: "unreadable", lasting: false });
  assert.deepEqual(r.send({ type: "forgotten" }), [{ do: "wipe" }]);
  // The wipe comes before any read.
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "wipe" }]);
  r.send({ type: "wiped", ok: true });
  assert.equal(r.state.unread, false);
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "list", run: 1, after: 0 }]);
  // A read that comes back late is not taken over the wiped cache.
  assert.deepEqual(r.send(loaded()), []);
  assert.equal(r.state.held.size, 0);
});
