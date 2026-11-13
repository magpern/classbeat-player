// Class sync's pure model (core/sync/sync-model.ts): paging and the cursor, removals, a full
// resync, backoff on 429 and on faults, offline, the three token codes, the pinned class, and a
// cache that belongs to another account.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Change, FetchResult, ListResult } from "../../src/core/sync/answers.ts";
import { backoffMs, FIRST_BACKOFF_MS, MAX_BACKOFF_MS, MAX_RETRY_AFTER_MS, retryWaitMs, SYNC_EVERY_MS } from "../../src/core/sync/backoff-policy.ts";
import { INITIAL, step } from "../../src/core/sync/sync-model.ts";
import type { Credential, Effect, SyncEvent, SyncState } from "../../src/core/sync/sync-model.ts";
import { syncView } from "../../src/core/sync/view.ts";
import { ID_A, ID_B, ID_C } from "./sync-fixtures.ts";

const ACCOUNT = "a".repeat(64);
const OTHER = "b".repeat(64);
const H1 = `sha256:${"1".repeat(64)}`;
const H2 = `sha256:${"2".repeat(64)}`;
const DOC = { format_version: "1.0" };
const PAIRED: Credential = { account: ACCOUNT, expired: false };

const cls = (id: string, position: number, hash = H1): Change => ({ id, removed: false, hash, position });
const gone = (id: string, position: number): Change => ({ id, removed: true, hash: null, position });
const pageOf = (changes: Change[], cursor: number, more = false): ListResult => ({ kind: "page", changes, cursor, more });
const kept = (hash = H1): FetchResult => ({ kind: "class", hash, document: DOC });

/** Drives the model; `effects` is what the last event asked for. */
function rig(held: [string, string][] = [], cursor = 0, account: string | null = held.length > 0 || cursor > 0 ? ACCOUNT : null) {
  let state: SyncState = INITIAL;
  let effects: readonly Effect[] = [];
  const r = {
    now: 1000,
    send(e: SyncEvent): readonly Effect[] {
      const out = step(state, e, r.now);
      state = out.state;
      effects = out.effects;
      return effects;
    },
    get state() {
      return state;
    },
    get run(): number {
      return state.run?.id ?? -1;
    },
    get effects() {
      return effects;
    },
    listed: (answer: ListResult) => r.send({ type: "listed", run: r.run, answer }),
    fetched: (id: string, answer: FetchResult) => r.send({ type: "fetched", run: r.run, id, answer }),
    written: (ok = true) => r.send({ type: "written", run: r.run, ok }),
    held: () => Object.fromEntries(state.held),
  };
  r.send({ type: "loaded", account, cursor, held: new Map(held) });
  return r;
}

test("a first sync pages through the changes, applies each in order and commits each page's cursor", () => {
  const r = rig();
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "list", run: 1, after: 0 }]);
  assert.deepEqual(r.listed(pageOf([cls(ID_A, 1), gone(ID_B, 2)], 2, true)), [{ do: "fetch", run: 1, id: ID_A }]);
  assert.deepEqual(r.fetched(ID_A, kept()), [{ do: "keep", run: 1, id: ID_A, hash: H1, document: DOC }]);
  // A removal deletes the cached document at once, before the cursor passes it.
  assert.deepEqual(r.written(), [{ do: "remove", run: 1, ids: [ID_B] }]);
  assert.deepEqual(r.written(), [{ do: "commit", run: 1, account: ACCOUNT, cursor: 2 }]);
  assert.equal(r.state.cursor, 0, "the cursor moves only once it is on disk");
  assert.deepEqual(r.written(), [{ do: "list", run: 1, after: 2 }]);
  assert.equal(r.state.cursor, 2);
  assert.deepEqual(r.listed(pageOf([cls(ID_C, 3)], 3)), [{ do: "fetch", run: 1, id: ID_C }]);
  r.fetched(ID_C, kept(H2));
  assert.deepEqual(r.written(), [{ do: "commit", run: 1, account: ACCOUNT, cursor: 3 }]);
  assert.deepEqual(r.written(), [{ do: "wake", at: r.now + SYNC_EVERY_MS }]);
  assert.deepEqual(r.held(), { [ID_A]: H1, [ID_C]: H2 });
  assert.deepEqual(syncView(r.state), { status: "synced", classes: 2, pinned: null });
  assert.equal(r.state.account, ACCOUNT);
});

test("an incremental sync asks after the stored cursor and fetches only what changed", () => {
  const r = rig([[ID_A, H1], [ID_B, H1]], 7);
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "list", run: 1, after: 7 }]);
  // A is listed with the hash already held (nothing to fetch); B has a new version.
  assert.deepEqual(r.listed(pageOf([cls(ID_A, 8), cls(ID_B, 9, H2)], 9)), [{ do: "fetch", run: 1, id: ID_B }]);
  r.fetched(ID_B, kept(H2));
  r.written();
  r.written();
  assert.deepEqual(r.held(), { [ID_A]: H1, [ID_B]: H2 });
  assert.equal(r.state.cursor, 9);
});

test("an empty page still commits its cursor, then the sync is done", () => {
  const r = rig([[ID_A, H1]], 4);
  r.send({ type: "due", credential: PAIRED });
  assert.deepEqual(r.listed(pageOf([], 4)), [{ do: "commit", run: 1, account: ACCOUNT, cursor: 4 }]);
  assert.deepEqual(r.written(), [{ do: "wake", at: r.now + SYNC_EVERY_MS }]);
});

test("a class removed between the page and its fetch is deleted; one that cannot be kept is skipped", () => {
  const r = rig([[ID_A, H1], [ID_B, H1]], 1);
  r.send({ type: "due", credential: PAIRED });
  r.listed(pageOf([cls(ID_A, 2, H2), cls(ID_B, 3, H2)], 3));
  assert.deepEqual(r.fetched(ID_A, { kind: "not_found" }), [{ do: "remove", run: 1, ids: [ID_A] }]);
  assert.deepEqual(r.written(), [{ do: "fetch", run: 1, id: ID_B }]);
  // Not kept, and the cached copy is not deleted for it.
  assert.deepEqual(r.fetched(ID_B, { kind: "unusable" }), [{ do: "commit", run: 1, account: ACCOUNT, cursor: 3 }]);
  r.written();
  assert.deepEqual(r.held(), { [ID_B]: H1 });
});

test("resync_required starts a full resync from 0; its cursor is committed at its end, after the leftovers go", () => {
  const r = rig([[ID_A, H1], [ID_C, H1]], 50);
  r.send({ type: "due", credential: PAIRED });
  assert.deepEqual(r.listed({ kind: "resync" }), [{ do: "list", run: 2, after: 0 }]);
  assert.equal(r.state.status, "syncing");
  // The first page: A held as it is, and more follow. No commit in the middle of a resync.
  assert.deepEqual(r.listed(pageOf([cls(ID_A, 1)], 1, true)), [{ do: "list", run: 2, after: 1 }]);
  assert.deepEqual(r.listed(pageOf([gone(ID_B, 2)], 2)), [{ do: "remove", run: 2, ids: [ID_B] }]);
  // C was not listed at all: it is not this account's any more.
  assert.deepEqual(r.written(), [{ do: "remove", run: 2, ids: [ID_C] }]);
  assert.deepEqual(r.written(), [{ do: "commit", run: 2, account: ACCOUNT, cursor: 2 }]);
  r.written();
  assert.deepEqual(r.held(), { [ID_A]: H1 });
  assert.equal(r.state.cursor, 2);
  assert.equal(r.state.status, "synced");
});

test("a second resync_required within a resync is not followed for ever", () => {
  const r = rig([], 5, ACCOUNT);
  r.send({ type: "due", credential: PAIRED });
  r.listed({ kind: "resync" });
  assert.deepEqual(r.listed({ kind: "resync" }), [{ do: "wake", at: r.now + FIRST_BACKOFF_MS }]);
  assert.equal(r.state.cursor, 5);
});

test("429: waits Retry-After, within bounds; without one, and for faults, the backoff doubles", () => {
  const r = rig([[ID_A, H1]], 3);
  r.send({ type: "due", credential: PAIRED });
  assert.deepEqual(r.listed({ kind: "retry", afterMs: 90_000 }), [{ do: "wake", at: r.now + 90_000 }]);
  assert.equal(r.state.status, "waiting");
  r.send({ type: "due", credential: PAIRED });
  assert.deepEqual(r.listed({ kind: "retry", afterMs: null }), [{ do: "wake", at: r.now + 2 * FIRST_BACKOFF_MS }]);
  r.send({ type: "due", credential: PAIRED });
  r.listed(pageOf([cls(ID_B, 4)], 4));
  assert.deepEqual(r.fetched(ID_B, { kind: "unexpected" }), [{ do: "wake", at: r.now + 4 * FIRST_BACKOFF_MS }]);
  assert.deepEqual(r.held(), { [ID_A]: H1 }, "nothing is deleted for a rate limit or a fault");
  assert.equal(r.state.cursor, 3);
  // A sync that goes through resets the backoff.
  r.send({ type: "due", credential: PAIRED });
  r.listed(pageOf([], 3));
  r.written();
  assert.equal(r.state.failures, 0);

  assert.equal(retryWaitMs(1, 0), 1000);
  assert.equal(retryWaitMs(1, 10 * MAX_RETRY_AFTER_MS), MAX_RETRY_AFTER_MS);
  assert.equal(backoffMs(1), FIRST_BACKOFF_MS);
  assert.equal(backoffMs(1000), MAX_BACKOFF_MS);
});

test("offline is a normal state: nothing is deleted, the cache plays, and it asks again later", () => {
  const r = rig([[ID_A, H1]], 3);
  r.send({ type: "due", credential: PAIRED });
  assert.deepEqual(r.listed({ kind: "offline" }), [{ do: "wake", at: r.now + FIRST_BACKOFF_MS }]);
  assert.equal(syncView(r.state).status, "offline");
  assert.deepEqual(r.held(), { [ID_A]: H1 });
  r.send({ type: "pin", id: ID_A, hash: H1 });
  assert.deepEqual(syncView(r.state).pinned, { id: ID_A, after: "none" });
  // Offline in the middle of a page as well.
  r.send({ type: "due", credential: PAIRED });
  r.listed(pageOf([cls(ID_B, 4)], 4));
  assert.deepEqual(r.fetched(ID_B, { kind: "offline" }), [{ do: "wake", at: r.now + 2 * FIRST_BACKOFF_MS }]);
  assert.equal(r.state.cursor, 3);
});

for (const where of ["list", "fetch"] as const) {
  test(`token_revoked and token_unknown (on ${where}) wipe the cache and end the pairing`, () => {
    const r = rig([[ID_A, H1]], 3);
    r.send({ type: "due", credential: PAIRED });
    if (where === "fetch") r.listed(pageOf([cls(ID_B, 4)], 4));
    const answer = { kind: "gone" } as const;
    assert.deepEqual(where === "list" ? r.listed(answer) : r.fetched(ID_B, answer), [{ do: "report", kind: "gone" }, { do: "wipe" }]);
    assert.deepEqual(r.held(), {});
    assert.equal(r.state.cursor, 0);
    assert.equal(r.state.account, null);
    assert.equal(r.state.status, "unpaired");
  });
}

test("token_expired keeps the cache, stops asking, and a new pairing to the same account continues", () => {
  const r = rig([[ID_A, H1]], 3);
  r.send({ type: "due", credential: PAIRED });
  assert.deepEqual(r.listed({ kind: "expired" }), [{ do: "report", kind: "expired" }, { do: "wake", at: r.now + SYNC_EVERY_MS }]);
  assert.deepEqual(r.held(), { [ID_A]: H1 });
  assert.equal(r.state.status, "expired");
  // Still expired: nothing is asked.
  assert.deepEqual(r.send({ type: "due", credential: { account: ACCOUNT, expired: true } }), [{ do: "wake", at: r.now + SYNC_EVERY_MS }]);
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "list", run: 2, after: 3 }]);
});

test("the pairing ending wipes the cache; with no pairing nothing is asked", () => {
  const r = rig([[ID_A, H1]], 3);
  r.send({ type: "due", credential: PAIRED });
  assert.deepEqual(r.send({ type: "forgotten" }), [{ do: "wipe" }]);
  // The answer to the request that was out is not applied.
  assert.deepEqual(r.send({ type: "listed", run: 1, answer: pageOf([cls(ID_B, 4)], 4) }), []);
  assert.deepEqual(r.held(), {});
  assert.deepEqual(r.send({ type: "due", credential: null }), [{ do: "wake", at: r.now + SYNC_EVERY_MS }]);
  // A later pairing starts from nothing.
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "list", run: 2, after: 0 }]);
});

test("a cache of another account, or of none recorded, is wiped before syncing from 0", () => {
  const r = rig([[ID_A, H1]], 9, OTHER);
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), [{ do: "wipe" }, { do: "list", run: 1, after: 0 }]);
  const u = rig([[ID_A, H1]], 0, null);
  assert.deepEqual(u.send({ type: "due", credential: PAIRED }), [{ do: "wipe" }, { do: "list", run: 1, after: 0 }]);
});

test("the class being played is never changed: a newer version is cached and shown as available", () => {
  const r = rig([[ID_A, H1]], 1);
  r.send({ type: "pin", id: ID_A, hash: H1 });
  r.send({ type: "due", credential: PAIRED });
  r.listed(pageOf([cls(ID_A, 2, H2)], 2));
  r.fetched(ID_A, kept(H2));
  r.written();
  r.written();
  assert.deepEqual(r.state.pinned, { id: ID_A, hash: H1 });
  assert.deepEqual(syncView(r.state).pinned, { id: ID_A, after: "newer" });
  r.send({ type: "unpin" });
  assert.equal(r.state.pinned, null);
  assert.deepEqual(r.held(), { [ID_A]: H2 });
});

test("a removal of the class being played deletes its cached copy at once; the snapshot plays on", () => {
  const r = rig([[ID_A, H1]], 1);
  r.send({ type: "pin", id: ID_A, hash: H1 });
  r.send({ type: "due", credential: PAIRED });
  assert.deepEqual(r.listed(pageOf([gone(ID_A, 2)], 2)), [{ do: "remove", run: 1, ids: [ID_A] }]);
  r.written();
  assert.deepEqual(syncView(r.state).pinned, { id: ID_A, after: "removed" });
});

test("revoked while a class plays: the wipe waits for the class to end, and nothing is asked meanwhile", () => {
  const r = rig([[ID_A, H1]], 1);
  r.send({ type: "pin", id: ID_A, hash: H1 });
  r.send({ type: "due", credential: PAIRED });
  assert.deepEqual(r.listed({ kind: "gone" }), [{ do: "report", kind: "gone" }]);
  assert.deepEqual(r.send({ type: "forgotten" }), []);
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), []);
  // Nothing new is pinned while the wipe waits.
  r.send({ type: "pin", id: ID_A, hash: H1 });
  assert.deepEqual(r.send({ type: "unpin" }), [{ do: "wipe" }, { do: "wake", at: r.now }]);
  assert.deepEqual(r.held(), {});
  assert.equal(r.state.pinned, null);
  assert.deepEqual(r.send({ type: "pin", id: ID_A, hash: H1 }), []);
  assert.equal(r.state.pinned, null);
});

test("another account's pairing while a class plays: wiped once it ends, then synced from 0", () => {
  const r = rig([[ID_A, H1]], 1);
  r.send({ type: "pin", id: ID_A, hash: H1 });
  assert.deepEqual(r.send({ type: "due", credential: { account: OTHER, expired: false } }), []);
  assert.deepEqual(r.send({ type: "unpin" }), [{ do: "wipe" }, { do: "wake", at: r.now }]);
  assert.deepEqual(r.send({ type: "due", credential: { account: OTHER, expired: false } }), [{ do: "list", run: 1, after: 0 }]);
});

test("only a class held, as it is held, can be pinned", () => {
  const r = rig([[ID_A, H1]], 1);
  r.send({ type: "pin", id: ID_B, hash: H1 });
  r.send({ type: "pin", id: ID_A, hash: H2 });
  assert.equal(r.state.pinned, null);
});

test("a write that fails counts nothing as held, keeps the cursor, and repeats the page later", () => {
  const r = rig([], 2, ACCOUNT);
  r.send({ type: "due", credential: PAIRED });
  r.listed(pageOf([cls(ID_A, 3)], 3));
  r.fetched(ID_A, kept());
  assert.deepEqual(r.written(false), [{ do: "wake", at: r.now + FIRST_BACKOFF_MS }]);
  assert.deepEqual(r.held(), {});
  r.send({ type: "due", credential: PAIRED });
  r.listed(pageOf([cls(ID_A, 3)], 3));
  r.fetched(ID_A, kept());
  r.written();
  assert.deepEqual(r.written(false), [{ do: "wake", at: r.now + 2 * FIRST_BACKOFF_MS }]);
  assert.equal(r.state.cursor, 2);
  assert.deepEqual(r.held(), { [ID_A]: H1 });
});

test("answers for another run, another class or nothing asked are ignored; one sync at a time", () => {
  const r = rig([], 0, null);
  assert.deepEqual(r.send({ type: "listed", run: 1, answer: pageOf([], 0) }), []);
  r.send({ type: "due", credential: PAIRED });
  assert.deepEqual(r.send({ type: "due", credential: PAIRED }), []);
  assert.deepEqual(r.send({ type: "listed", run: 7, answer: pageOf([], 0) }), []);
  r.listed(pageOf([cls(ID_A, 1)], 1));
  assert.deepEqual(r.fetched(ID_B, kept()), []);
  assert.deepEqual(r.written(), []);
  assert.deepEqual(r.send({ type: "loaded", account: OTHER, cursor: 9, held: new Map() }), []);
  assert.equal(r.state.cursor, 0);
});
