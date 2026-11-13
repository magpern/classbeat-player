// Class sync's edge (main/sync/service.ts) with the real cache in a temporary folder, a fake player
// API that only records what it is asked, and a timer the test fires by hand: a class of one
// account is never pinned under another's pairing, a cache that cannot be read is kept and read
// again with the fault backoff, a cache shown to be no account's is wiped, and a wipe that leaves
// files behind stays pending. No network at all, and nothing is logged.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { document, ID_A, ID_B, ok, page, STAMP } from "./sync-fixtures.ts";

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
  cache.keep(ANN, ID_A, contentHash(doc), doc, STAMP);
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
  assert.deepEqual(s.list(), []);
  assert.equal(s.view().pinned, null);
  // Ann paired again: hers plays, and is listed.
  credential = credentialOf(ANN);
  assert.equal(s.list().length, 1);
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
  assert.deepEqual(s.view(), { status: "unavailable", unavailable: "passing", wiping: false, classes: 0, notUpdated: [], pinned: null });
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
  assert.deepEqual(s.view(), { status: "synced", unavailable: null, wiping: false, classes: 1, notUpdated: [], pinned: null });
  assert.ok(s.pin(ID_A) !== null);
  assert.deepEqual(logged, []);
});

test("a cache shown to hold classes with no cursor is wiped at start, paired or not", () => {
  annsCache();
  rmSync(join(dir, SYNC_FILE));
  const s = service();
  s.start();
  assert.equal(existsSync(dir), false);
  assert.deepEqual(s.view(), { status: "unpaired", unavailable: null, wiping: false, classes: 0, notUpdated: [], pinned: null });
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
  assert.deepEqual(s.view(), { status: "unpaired", unavailable: null, wiping: true, classes: 0, notUpdated: [], pinned: null });
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

test("the class list is the cached classes in title order, with their times, built from what reads back", async () => {
  const cache = classCache(dir);
  const b = document("beta");
  const a = document("Alpha");
  cache.keep(ANN, ID_A, contentHash(b), b, STAMP);
  cache.keep(ANN, ID_B, contentHash(a), a, "2026-11-05T08:30:00+00:00");
  cache.commit(ANN, 3);
  credential = credentialOf(ANN);
  const s = service();
  s.start();
  await settle();
  const rows = s.list();
  assert.deepEqual(rows.map((r) => [r.title, r.updated]), [["Alpha", "2026-11-05T08:30:00+00:00"], ["beta", STAMP]]);
  assert.equal(JSON.stringify(rows).includes(TOKEN), false);
  // A class file that no longer has its hash is not listed.
  writeFileSync(join(dir, CLASSES_DIR, `${ID_A}.json`), readFileSync(join(dir, CLASSES_DIR, `${ID_A}.json`), "utf8").replace("beta", "BETA"));
  assert.deepEqual(s.list().map((r) => r.title), ["Alpha"]);
  assert.deepEqual(logged, []);
});

test("a folder in a class file's place, or a file in the class folder's, is a lasting fault; a disk error is a passing one", () => {
  const faults: [string, "lasting" | "passing"][] = [["ENOTDIR", "lasting"], ["EISDIR", "lasting"], ["EIO", "passing"], ["EACCES", "passing"]];
  for (const [code, kind] of faults) {
    annsCache();
    credential = credentialOf(ANN);
    const read = (): Buffer | null => {
      throw Object.assign(new Error(code), { code });
    };
    const s = service(classCache(dir, rmSync, read));
    s.start();
    assert.equal(s.view().status, "unavailable", code);
    assert.equal(s.view().unavailable, kind, code);
    s.stop();
  }
});

test("the class list gives nothing of one account under another's pairing: Ann's class, her pairing forgotten, Bob paired", async () => {
  annsCache();
  credential = credentialOf(ANN);
  const s = service();
  s.start();
  await settle();
  assert.deepEqual(s.list().map((r) => r.title), ["Ann's class"]);
  assert.ok(s.pin(ID_A) !== null);
  // The pairing ends while the class plays: the cache waits to be wiped.
  credential = null;
  s.forgotten();
  assert.deepEqual(s.list(), []);
  credential = credentialOf(BOB);
  s.syncNow();
  await settle();
  assert.equal(s.view().classes, 1, "Ann's class is still held for the snapshot that plays");
  assert.deepEqual(s.list(), []);
  s.unpin();
  assert.deepEqual(s.list(), []);
  assert.deepEqual(logged, []);
});

test("the class list shows none of the classes the plate says were removed, once unpaired", async () => {
  annsCache();
  credential = credentialOf(ANN);
  const s = service();
  s.start();
  await settle();
  assert.equal(s.list().length, 1);
  // Not playing: the cache is wiped at once.
  credential = null;
  s.forgotten();
  assert.deepEqual(s.list(), []);
  // Playing: it waits, and nothing is listed meanwhile.
  annsCache();
  const t = service();
  credential = credentialOf(ANN);
  t.start();
  await settle();
  assert.ok(t.pin(ID_A) !== null);
  credential = null;
  t.forgotten();
  assert.deepEqual(t.list(), []);
});

test("the class list gives a class only as the version held, and only from a file of the held account", async () => {
  annsCache();
  credential = credentialOf(ANN);
  const s = service();
  s.start();
  await settle();
  assert.equal(s.list().length, 1);
  // A good file of another version than the one held (a keep not yet reported on disk).
  const other = document("Another version");
  classCache(dir).keep(ANN, ID_A, contentHash(other), other, STAMP);
  assert.equal(s.pin(ID_A), null);
  assert.deepEqual(s.list(), []);
  // A good file with the held version's content but another account's.
  const same = document("Ann's class");
  classCache(dir).keep(BOB, ID_A, contentHash(same), same, STAMP);
  assert.deepEqual(s.list(), []);
});
