// Class sync's edge (main/sync/service.ts) with the real cache in a temporary folder, a fake player
// API that only records what it is asked, and a timer the test fires by hand: a class of one
// account is never pinned under another's pairing, a cache that cannot be read is kept and read
// again with the fault backoff, a cache shown to be no account's is wiped, and a wipe that leaves
// files behind stays pending. No network at all, and nothing is logged.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { RmOptions } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { contentHash } from "classformat/src/index.ts";
import { FIRST_BACKOFF_MS } from "../../src/core/sync/backoff-policy.ts";
import type { HttpAnswer } from "../../src/core/pairing/protocol.ts";
import { readCapped } from "../../src/main/capped-read.ts";
import type { BackendRequest } from "../../src/main/pairing/http.ts";
import { classCache, CLASSES_DIR, SYNC_FILE, WIPE_FILE } from "../../src/main/sync/cache.ts";
import { createSyncService } from "../../src/main/sync/service.ts";
import type { SyncCredential, SyncService } from "../../src/main/sync/service.ts";
import { document, ID_A, ok, page } from "./sync-fixtures.ts";

const ANN = "a".repeat(64);
const BOB = "b".repeat(64);
const TOKEN = `cbp_dev_${"t".repeat(43)}`;
const credentialOf = (account: string): SyncCredential => ({ origin: "https://classbeat.example", token: TOKEN, account, expired: false });

let dir: string;
let credential: SyncCredential | null;
let asked: BackendRequest[];
let timers: { fn: () => void; ms: number }[];
let now: number;
let sync: SyncService | undefined;
const logged: unknown[][] = [];
const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "cbp-sync-service-")), "class-cache");
  credential = null;
  asked = [];
  timers = [];
  now = 1_000_000;
  logged.length = 0;
  for (const k of Object.keys(saved) as (keyof typeof saved)[]) console[k] = (...a: unknown[]) => void logged.push(a);
});
afterEach(() => {
  Object.assign(console, saved);
  sync?.stop();
  sync = undefined;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

/** A sync service on the folder; the fake API answers every page as empty at the cursor asked. */
function service(cache = classCache(dir)): SyncService {
  sync = createSyncService({
    now: () => now,
    call: async (req): Promise<HttpAnswer> => {
      asked.push(req);
      const after = Number(new URL(req.path, "http://x").searchParams.get("after"));
      return ok(page([], after));
    },
    cache,
    credential: () => credential,
    report: () => assert.fail("nothing to report"),
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => undefined,
  });
  return sync;
}
/** Fires the last timer set, as its time comes. */
function fireTimer(): void {
  const t = timers.pop();
  assert.ok(t !== undefined, "a timer is set");
  now += t.ms;
  t.fn();
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

/** Ann's cache on disk: one class and a cursor. */
function annsCache(): string {
  const doc = document("Ann's class");
  const cache = classCache(dir);
  cache.keep(ANN, ID_A, contentHash(doc), doc);
  cache.commit(ANN, 3);
  return readFileSync(join(dir, CLASSES_DIR, `${ID_A}.json`), "utf8");
}

test("a class is not pinned while the pairing is another account's, before sync has wiped the cache", () => {
  annsCache();
  const s = service();
  // Unpaired at start: the cache is Ann's and plays as hers (no pairing to tell otherwise).
  s.start();
  assert.equal(asked.length, 0);
  assert.ok(s.pin(ID_A) !== null);
  s.unpin();
  // Bob is paired now, and no sync has run since: the cache and the file both still say Ann.
  credential = credentialOf(BOB);
  assert.equal(s.pin(ID_A), null);
  assert.equal(s.view().pinned, null);
  // Ann paired again: hers plays.
  credential = credentialOf(ANN);
  assert.ok(s.pin(ID_A) !== null);
  assert.deepEqual(logged, []);
});

test("a cache that cannot be read at start is kept: sync is unavailable, and the read is tried again with the backoff", async () => {
  const file = annsCache();
  const fault = { on: true };
  const read = (f: string, max: number): Buffer | null => {
    if (fault.on) throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
    return readCapped(f, max);
  };
  credential = credentialOf(ANN);
  const s = service(classCache(dir, rmSync, read));
  s.start();
  assert.deepEqual(s.view(), { status: "unavailable", classes: 0, pinned: null });
  assert.equal(s.pin(ID_A), null);
  assert.deepEqual(timers.map((t) => t.ms), [FIRST_BACKOFF_MS]);
  // Still failing at the next try: the wait doubles, nothing is asked, nothing is deleted.
  fireTimer();
  assert.deepEqual(timers.map((t) => t.ms), [2 * FIRST_BACKOFF_MS]);
  assert.equal(s.view().status, "unavailable");
  await settle();
  assert.equal(asked.length, 0);
  assert.equal(readFileSync(join(dir, CLASSES_DIR, `${ID_A}.json`), "utf8"), file);
  assert.equal(existsSync(join(dir, SYNC_FILE)), true);
  assert.equal(existsSync(join(dir, WIPE_FILE)), false);
  // The disk is back: the cache is read, synced on from its cursor, and plays.
  fault.on = false;
  fireTimer();
  await settle();
  assert.deepEqual(asked.map((r) => r.path), ["/api/player/changes?after=3&limit=100"]);
  assert.deepEqual(s.view(), { status: "synced", classes: 1, pinned: null });
  assert.ok(s.pin(ID_A) !== null);
  assert.deepEqual(logged, []);
});

test("a cache shown to hold classes with no cursor is wiped at start, paired or not", () => {
  annsCache();
  rmSync(join(dir, SYNC_FILE));
  const s = service();
  s.start();
  assert.equal(existsSync(dir), false);
  assert.deepEqual(s.view(), { status: "unpaired", classes: 0, pinned: null });
  assert.equal(asked.length, 0);
});

test("a wipe that reports success but leaves the classes behind stays pending: nothing plays or syncs until it is done", async () => {
  annsCache();
  const leaky = { on: true };
  const remove = (path: string, options?: RmOptions): void => {
    if (leaky.on && (path.endsWith(CLASSES_DIR) || path === dir)) return;
    rmSync(path, options);
  };
  credential = credentialOf(ANN);
  const s = service(classCache(dir, remove));
  s.start();
  await settle();
  asked = [];
  // The pairing ends; the wipe leaves Ann's class on disk.
  credential = null;
  s.forgotten();
  assert.equal(existsSync(join(dir, CLASSES_DIR, `${ID_A}.json`)), true);
  assert.equal(existsSync(join(dir, WIPE_FILE)), true);
  assert.deepEqual(s.view(), { status: "unpaired", classes: 0, pinned: null });
  // Bob pairs: the wipe is tried again first, nothing is asked, nothing plays.
  credential = credentialOf(BOB);
  s.syncNow();
  await settle();
  assert.equal(asked.length, 0);
  assert.equal(s.pin(ID_A), null);
  assert.equal(existsSync(join(dir, WIPE_FILE)), true);
  // The delete works again: wiped, then Bob syncs from 0.
  leaky.on = false;
  s.syncNow();
  assert.equal(existsSync(dir), false);
  s.syncNow();
  await settle();
  assert.deepEqual(asked.map((r) => r.path), ["/api/player/changes?after=0&limit=100"]);
  assert.equal(s.pin(ID_A), null);
  assert.deepEqual(logged, []);
});
