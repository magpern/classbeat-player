// What class sync's pure model keeps for the class list (core/sync/sync-model.ts, view.ts): the
// publication time kept with each class, the classes skipped as not updated, the wipe, the fault
// backoff reset by a good read, and the read fault a retry cannot cure.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Change, FetchResult, ListResult } from "../../src/core/sync/answers.ts";
import { backoffMs, FIRST_BACKOFF_MS } from "../../src/core/sync/backoff-policy.ts";
import { INITIAL, step } from "../../src/core/sync/sync-model.ts";
import type { Credential, Effect, SyncEvent, SyncState } from "../../src/core/sync/sync-model.ts";
import { syncView } from "../../src/core/sync/view.ts";
import { ID_A, ID_B } from "./sync-fixtures.ts";

const ACCOUNT = "a".repeat(64);
const H1 = `sha256:${"1".repeat(64)}`;
const H2 = `sha256:${"2".repeat(64)}`;
const T1 = "2026-11-01T10:00:00+00:00";
const T2 = "2026-11-05T08:30:00+00:00";
const DOC = { format_version: "1.0" };
const PAIRED: Credential = { account: ACCOUNT, expired: false };

const cls = (id: string, position: number, hash: string, publishedAt: string): Change => ({ id, removed: false, hash, publishedAt, position });
const gone = (id: string, position: number): Change => ({ id, removed: true, hash: null, publishedAt: T2, position });
const pageOf = (changes: Change[], cursor: number): ListResult => ({ kind: "page", changes, cursor, more: false });

function rig(held: [string, string][] = [], published: [string, string][] = []) {
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
    get effects() {
      return effects;
    },
    listed: (changes: Change[], cursor: number) => r.send({ type: "listed", run: state.run?.id ?? -1, answer: pageOf(changes, cursor) }),
    fetched: (id: string, answer: FetchResult) => r.send({ type: "fetched", run: state.run?.id ?? -1, id, answer }),
    written: (ok = true) => r.send({ type: "written", run: state.run?.id ?? -1, ok }),
    /** A sync that lists `changes`, with every class fetched as `answers` says, and every write good. */
    sync(changes: Change[], answers: Record<string, FetchResult>, cursor = 9): void {
      r.send({ type: "due", credential: PAIRED });
      r.listed(changes, cursor);
      for (let n = 0; n < 20 && state.run !== null; n++) {
        const e = effects[0];
        if (e?.do === "fetch") r.fetched(e.id, answers[e.id] ?? { kind: "unexpected" });
        else if (e?.do === "list") r.listed([], cursor);
        else r.written();
      }
    },
  };
  r.send({ type: "loaded", account: held.length > 0 ? ACCOUNT : null, cursor: 0, held: new Map(held), published: new Map(published), wipePending: false });
  return r;
}
const kept = (hash: string): FetchResult => ({ kind: "class", hash, document: DOC });

test("the publication time of a class is asked to be kept with it, and held once it is on disk", () => {
  const r = rig();
  r.send({ type: "due", credential: PAIRED });
  r.listed([cls(ID_A, 1, H1, T1)], 1);
  assert.deepEqual(r.fetched(ID_A, kept(H1)), [{ do: "keep", run: 1, account: ACCOUNT, id: ID_A, hash: H1, publishedAt: T1, document: DOC }]);
  assert.equal(r.state.published.get(ID_A), undefined, "not held before it is on disk");
  r.written();
  assert.equal(r.state.published.get(ID_A), T1);
});

test("a newer version replaces the time, and a removal or a full resync's leftover drops it", () => {
  const r = rig([[ID_A, H1], [ID_B, H1]], [[ID_A, T1], [ID_B, T1]]);
  r.sync([cls(ID_A, 5, H2, T2), gone(ID_B, 6)], { [ID_A]: kept(H2) });
  assert.deepEqual([...r.state.published], [[ID_A, T2]]);
  assert.deepEqual([...r.state.held], [[ID_A, H2]]);
});

test("a cache loaded without times (an older file) holds its classes, and no time is made up", () => {
  const r = rig([[ID_A, H1]]);
  assert.equal(r.state.held.size, 1);
  assert.equal(r.state.published.size, 0);
});

test("not updated: an unusable answer marks the class, a kept version or a removal clears it", () => {
  const r = rig([[ID_A, H1], [ID_B, H1]], [[ID_A, T1], [ID_B, T1]]);
  r.sync([cls(ID_A, 1, H2, T2), cls(ID_B, 2, H2, T2)], { [ID_A]: { kind: "unusable" }, [ID_B]: { kind: "unusable" } });
  assert.deepEqual(syncView(r.state).notUpdated, [ID_A, ID_B]);
  // The older copies stay, and keep their own time.
  assert.deepEqual([...r.state.held], [[ID_A, H1], [ID_B, H1]]);
  assert.equal(r.state.published.get(ID_A), T1);
  // The mark outlives the run (the cursor passed the class; nothing fetches it again by itself).
  r.send({ type: "due", credential: PAIRED });
  r.listed([], 9);
  while (r.state.run !== null) r.written();
  assert.deepEqual(syncView(r.state).notUpdated, [ID_A, ID_B]);
  // A version kept clears one, a removal clears the other.
  r.sync([cls(ID_A, 10, H2, T2), gone(ID_B, 11)], { [ID_A]: kept(H2) }, 11);
  assert.deepEqual(syncView(r.state).notUpdated, []);
  assert.equal(r.state.published.get(ID_A), T2);
  assert.equal(r.state.notUpdated.size, 0);
});

test("not updated: a class skipped that was never cached is not listed, and a wipe clears every mark", () => {
  const r = rig([[ID_A, H1]], [[ID_A, T1]]);
  r.sync([cls(ID_B, 1, H1, T1), cls(ID_A, 2, H2, T2)], { [ID_B]: { kind: "unusable" }, [ID_A]: { kind: "unusable" } });
  assert.deepEqual(syncView(r.state).notUpdated, [ID_A]);
  r.send({ type: "forgotten" });
  assert.deepEqual(syncView(r.state).notUpdated, []);
  assert.equal(r.state.notUpdated.size, 0);
  assert.equal(r.state.published.size, 0);
});

test("the view says a wipe is waiting, and stops saying it once it is done", () => {
  const r = rig([[ID_A, H1]], [[ID_A, T1]]);
  assert.equal(syncView(r.state).wiping, false);
  r.send({ type: "forgotten" });
  assert.deepEqual(r.effects, [{ do: "wipe" }]);
  assert.equal(syncView(r.state).wiping, true);
  assert.equal(syncView(r.state).classes, 0);
  r.send({ type: "wiped", ok: false });
  assert.equal(syncView(r.state).wiping, true);
  r.send({ type: "wiped", ok: true });
  assert.equal(syncView(r.state).wiping, false);
});

test("a wipe waiting for the class being played to end is not shown as wiping: the status is unpaired", () => {
  const r = rig([[ID_A, H1]], [[ID_A, T1]]);
  r.send({ type: "pin", id: ID_A, hash: H1 });
  r.send({ type: "forgotten" });
  assert.equal(r.state.wipeAfterPin, true);
  assert.equal(syncView(r.state).wiping, false);
  assert.equal(syncView(r.state).status, "unpaired");
});

test("a read that works resets the fault count: the first sync fault after it waits one step", () => {
  let state: SyncState = INITIAL;
  const send = (e: SyncEvent, now = 1000): readonly Effect[] => {
    const out = step(state, e, now);
    state = out.state;
    return out.effects;
  };
  // Three faults reading the cache, each waiting twice as long as the one before.
  for (let n = 1; n <= 3; n++) assert.deepEqual(send({ type: "unreadable", lasting: false }), [{ do: "wake", at: 1000 + backoffMs(n) }]);
  assert.equal(state.failures, 3);
  send({ type: "loaded", account: ACCOUNT, cursor: 1, held: new Map([[ID_A, H1]]), published: new Map(), wipePending: false });
  assert.equal(state.failures, 0);
  // The first sync fault after the recovered read: the first step, not the fourth.
  send({ type: "due", credential: PAIRED });
  assert.deepEqual(send({ type: "listed", run: 1, answer: { kind: "offline" } }), [{ do: "wake", at: 1000 + FIRST_BACKOFF_MS }]);
});

test("a read fault that retrying cannot cure is told apart from a passing one, until a read works", () => {
  assert.equal(syncView(INITIAL).unavailable, null);
  let state = INITIAL;
  state = step(state, { type: "unreadable", lasting: true }, 1000).state;
  assert.deepEqual([syncView(state).status, syncView(state).unavailable], ["unavailable", "lasting"]);
  // A later fault of the other kind is the one shown.
  state = step(state, { type: "unreadable", lasting: false }, 1000).state;
  assert.equal(syncView(state).unavailable, "passing");
  state = step(state, { type: "unreadable", lasting: true }, 1000).state;
  assert.equal(syncView(state).unavailable, "lasting");
  state = step(state, { type: "loaded", account: null, cursor: 0, held: new Map(), published: new Map(), wipePending: false }, 1000).state;
  assert.equal(syncView(state).unavailable, null);
  assert.equal(state.lasting, false);
});

test("not updated: when the server lists the version already held, the mark goes", () => {
  const r = rig([[ID_A, H1]], [[ID_A, T1]]);
  r.sync([cls(ID_A, 1, H2, T2)], { [ID_A]: { kind: "unusable" } });
  assert.deepEqual(syncView(r.state).notUpdated, [ID_A]);
  // Published again as the very version held: nothing to fetch, and the copy is current.
  r.send({ type: "due", credential: PAIRED });
  r.listed([cls(ID_A, 10, H1, T2)], 10);
  assert.deepEqual(syncView(r.state).notUpdated, []);
  assert.equal(r.state.held.get(ID_A), H1);
});
