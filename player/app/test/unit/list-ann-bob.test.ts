// Nothing from another account is ever shown: Ann's classes, then Bob's pairing, driven through
// the real sync service and its cache (a temporary folder), the list controller and the screen's
// model. At every step, everything the window is sent and everything it would paint is searched
// for Ann's titles. A fake player API only answers empty pages; no network, no real account.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { contentHash } from "classformat/src/index.ts";
import { screenOf } from "../../src/core/list/screen.ts";
import type { PairingView } from "../../src/core/pairing/view.ts";
import { EMPTY_SNAPSHOT } from "../../src/core/snapshot.ts";
import type { HttpAnswer } from "../../src/core/pairing/protocol.ts";
import { createListController } from "../../src/main/list/list-controller.ts";
import { classCache, CLASSES_DIR } from "../../src/main/sync/cache.ts";
import { createSyncService } from "../../src/main/sync/service.ts";
import type { SyncCredential, SyncService } from "../../src/main/sync/service.ts";
import { changeOf, classBody, document, ID_A, ok, page, STAMP } from "./sync-fixtures.ts";
import { NOW } from "./list-fixtures.ts";

const ANN = "a".repeat(64);
const BOB = "b".repeat(64);
const credentialOf = (account: string): SyncCredential => ({ origin: "https://classbeat.example", token: `cbp_dev_${"t".repeat(43)}`, account, expired: false });
const paired = (email: string): PairingView => ({ state: "paired", email, deviceName: null, pairAgain: false });

let dir: string;
let credential: SyncCredential | null;
let pairing: PairingView;
let sync: SyncService | undefined;

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "cbp-list-ann-bob-")), "class-cache");
  credential = null;
});
afterEach(() => {
  sync?.stop();
  sync = undefined;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

test("Ann's classes are never shown to Bob, before or after sync has wiped them", async () => {
  const doc = document("Ann's secret class");
  const cache = classCache(dir);
  cache.keep(ANN, ID_A, contentHash(doc), doc, STAMP);
  cache.commit(ANN, 3);
  credential = credentialOf(ANN);
  pairing = paired("ann@example.com");
  sync = createSyncService({
    now: () => Date.now(),
    call: async (req): Promise<HttpAnswer> => ok(page([], Number(new URL(req.path, "http://x").searchParams.get("after")))),
    cache,
    credential: () => credential,
    report: () => undefined,
    setTimer: () => undefined,
    clearTimer: () => undefined,
  });
  const list = createListController({ sync, pairing: { view: () => pairing }, open: () => EMPTY_SNAPSHOT });
  /** Everything the window is sent and everything it would paint at this moment. */
  const shown = (): string => {
    const v = list.view();
    return JSON.stringify([v, screenOf(v, { filter: "", selectedId: null, lastStartedId: null }, NOW)]);
  };

  sync.start();
  await settle();
  assert.match(shown(), /Ann's secret class/, "Ann sees her own class");

  // Bob is paired now and no sync has run since: the cache still says Ann.
  credential = credentialOf(BOB);
  pairing = paired("bob@example.com");
  assert.doesNotMatch(shown(), /Ann's secret class/);
  assert.equal(list.start(ID_A, contentHash(doc)), false, "and Ann's class cannot be started");

  // Sync runs for Bob: the cache is wiped, and Bob's list is empty.
  sync.syncNow();
  await settle();
  assert.doesNotMatch(shown(), /Ann's secret class/);
  assert.equal(list.view().rows.length, 0);

  // Ann pairs again on another day: her classes come from the server again, not from this cache.
  credential = null;
  pairing = { state: "unpaired", message: null };
  assert.doesNotMatch(shown(), /Ann's secret class/);
});

test("Ann plays a class, the server removes it, then Bob pairs: nothing of Ann's is sent or painted, and the wipe runs once her class ends", async () => {
  const doc = document("Ann's playing class");
  const cache = classCache(dir);
  cache.keep(ANN, ID_A, contentHash(doc), doc, STAMP);
  cache.commit(ANN, 3);
  credential = credentialOf(ANN);
  pairing = paired("ann@example.com");
  let removed = false;
  sync = createSyncService({
    now: () => Date.now(),
    call: async (req): Promise<HttpAnswer> => {
      const after = Number(new URL(req.path, "http://x").searchParams.get("after"));
      return ok(removed && after < 4 ? page([changeOf(ID_A, 4, null)], 4) : page([], after));
    },
    cache,
    credential: () => credential,
    report: () => undefined,
    setTimer: () => undefined,
    clearTimer: () => undefined,
  });
  const list = createListController({ sync, pairing: { view: () => pairing }, open: () => ({ ...EMPTY_SNAPSHOT, doc: { class: {} } }) as never });
  const shown = (): string => {
    const v = list.view();
    return JSON.stringify([v, screenOf(v, { filter: "", selectedId: null, lastStartedId: null }, NOW)]);
  };
  sync.start();
  await settle();
  assert.match(shown(), /Ann's playing class/);
  assert.equal(list.start(ID_A, contentHash(doc)), true);
  assert.equal(list.start(ID_A, contentHash(doc)), false, "one class at a time");

  removed = true;
  sync.syncNow();
  await settle();
  assert.match(shown(), /Removed: plays to the end/, "Ann still sees her playing class as the snapshot");

  credential = credentialOf(BOB);
  pairing = paired("bob@example.com");
  sync.syncNow();
  await settle();
  assert.doesNotMatch(shown(), /Ann's playing class/);
  assert.equal(existsSync(dir), true, "the wipe waits for the class");

  // The class ends: the pin is released, the waiting wipe runs, and still nothing of Ann's.
  list.release();
  await settle();
  assert.equal(sync.view().pinned, null);
  assert.equal(existsSync(join(dir, CLASSES_DIR, `${ID_A}.json`)), false, "Ann's class is wiped from the disk");
  assert.doesNotMatch(shown(), /Ann's playing class/);
});

test("a newer version of the class being played applies once it ends", async () => {
  const v1 = document("Quick spin");
  const v2 = document("Quick spin, new");
  const cache = classCache(dir);
  cache.keep(ANN, ID_A, contentHash(v1), v1, STAMP);
  cache.commit(ANN, 3);
  credential = credentialOf(ANN);
  pairing = paired("ann@example.com");
  let newer = false;
  sync = createSyncService({
    now: () => Date.now(),
    call: async (req): Promise<HttpAnswer> => {
      const u = new URL(req.path, "http://x");
      if (u.pathname.endsWith(ID_A)) return ok(classBody(ID_A, v2, 4));
      const after = Number(u.searchParams.get("after"));
      return ok(newer && after < 4 ? page([changeOf(ID_A, 4, v2)], 4) : page([], after));
    },
    cache,
    credential: () => credential,
    report: () => undefined,
    setTimer: () => undefined,
    clearTimer: () => undefined,
  });
  const list = createListController({ sync, pairing: { view: () => pairing }, open: () => ({ ...EMPTY_SNAPSHOT, doc: { class: {} } }) as never });
  sync.start();
  await settle();
  list.view();
  assert.equal(list.start(ID_A, contentHash(v1)), true);
  newer = true;
  sync.syncNow();
  await settle();
  assert.equal(list.view().sync.pinned?.after, "newer");
  list.release();
  assert.equal(list.view().sync.pinned, null);
  assert.equal(list.view().rows[0].title, "Quick spin, new");
  assert.equal(list.view().rows[0].playing, false);
});

test("a start of a version the list did not show is refused by the sync service itself", async () => {
  const doc = document("Quick spin");
  const cache = classCache(dir);
  cache.keep(ANN, ID_A, contentHash(doc), doc, STAMP);
  cache.commit(ANN, 1);
  credential = credentialOf(ANN);
  sync = createSyncService({
    now: () => Date.now(),
    call: async (): Promise<HttpAnswer> => ok(page([], 1)),
    cache,
    credential: () => credential,
    report: () => undefined,
    setTimer: () => undefined,
    clearTimer: () => undefined,
  });
  sync.start();
  await settle();
  assert.equal(sync.pin(ID_A, `sha256:${"0".repeat(64)}`), null, "another version");
  assert.equal(sync.view().pinned, null);
  assert.ok(sync.pin(ID_A, contentHash(doc)) !== null, "the version held");
  assert.equal(sync.view().pinned?.id, ID_A);
});
