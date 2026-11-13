// Class sync end to end against a fake player API on loopback: the real HTTP client, the real cache
// in a temporary folder, and the real pairing service holding the token. The first sync, an
// incremental sync, a removal, the class being played kept during play, and the wipe after the
// device is revoked, a wipe that fails before another account pairs, and a restart with a wipe left
// unfinished. No network beyond 127.0.0.1, and nothing is logged.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import type { RmOptions } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { recordText } from "../../src/core/pairing/record.ts";
import { classCache, CLASSES_DIR, SYNC_FILE, WIPE_FILE } from "../../src/main/sync/cache.ts";
import { createBackendCall } from "../../src/main/pairing/http.ts";
import { memoryStore } from "../../src/main/pairing/keychain.ts";
import { createPairingService } from "../../src/main/pairing/service.ts";
import type { PairingService } from "../../src/main/pairing/service.ts";
import { credentialOf, linkAndStart } from "../../src/main/sync/link.ts";
import { createSyncService } from "../../src/main/sync/service.ts";
import type { SyncService } from "../../src/main/sync/service.ts";
import { newToken } from "./pairing-tokens.ts";
import { changeOf, classBody, document, ID_A, ID_B, ID_C, page } from "./sync-fixtures.ts";

// --- the fake player API: the account's classes in sync order, answered as the contract says ---
interface Entry {
  readonly position: number;
  readonly doc: Record<string, unknown> | null;
}
const entries = new Map<string, Entry>();
let place = 0;
let pageMax = 2;
let token = "";
let refusal: { status: number; body: unknown } | null = null;
const requests: { url: string; auth: string | undefined }[] = [];

const publish = (id: string, doc: Record<string, unknown> | null): void => void entries.set(id, { position: ++place, doc });

function answer(req: IncomingMessage, res: ServerResponse): void {
  const send = (status: number, body: unknown): void => void res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  requests.push({ url: req.url ?? "", auth: req.headers.authorization });
  if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "token_unknown" });
  if (refusal !== null) return send(refusal.status, refusal.body);
  if (url.pathname === "/api/player/device") return send(200, { device: { name: "Studio" } });
  if (url.pathname === "/api/player/changes") {
    const afterPlace = Number(url.searchParams.get("after"));
    const limit = Math.min(Number(url.searchParams.get("limit")), pageMax);
    const all = [...entries].filter(([, e]) => e.position > afterPlace).sort((x, y) => x[1].position - y[1].position);
    const shown = all.slice(0, limit);
    const cursor = shown.length > 0 ? shown[shown.length - 1][1].position : afterPlace;
    return send(200, page(shown.map(([id, e]) => changeOf(id, e.position, e.doc)), cursor, all.length > limit));
  }
  const id = /^\/api\/player\/classes\/([0-9a-f-]{36})$/.exec(url.pathname)?.[1];
  const held = id === undefined ? undefined : entries.get(id);
  if (id === undefined || held === undefined || held.doc === null) return send(404, { error: "not_found" });
  return send(200, classBody(id, held.doc, held.position));
}

let server: Server;
let origin: string;
before(async () => {
  server = createServer(answer);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

// --- the app's side: nothing logged, a temporary cache, the pairing holding the token ---
const logged: unknown[][] = [];
const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
let dir: string;
let pairing!: PairingService;
let sync!: SyncService;
const reports: string[] = [];
/** Every token issued in this file: the server may still see an earlier one's last request. */
const tokens: string[] = [];

const call = createBackendCall();

/** A new pairing with a new token, to `email`'s account, or none for null; sync reads it from now on. */
function pairAs(email: string | null): void {
  pairing?.stop();
  token = newToken("dev");
  tokens.push(token);
  const store = memoryStore();
  if (email !== null) store.save(recordText({ origin, token, email }));
  pairing = createPairingService({
    now: () => Date.now(),
    call,
    store,
    openPage: () => undefined,
    origin: () => ({ ok: true, origin }),
    allowLoopbackHttp: true,
    platform: "linux",
    version: "0",
    setTimer: () => null,
    clearTimer: () => undefined,
  });
  pairing.load();
}

/** A new app on the same folder, as after a restart: a new pairing (see `pairAs`) and sync, not started. */
function freshApp(email: string | null = "ann@example.test", remove?: (path: string, options?: RmOptions) => void): void {
  sync?.stop();
  pairAs(email);
  sync = createSyncService({
    now: () => Date.now(),
    call,
    cache: classCache(dir, remove),
    credential: () => credentialOf(pairing),
    report: (kind) => (reports.push(kind), pairing.tokenRefused(kind)),
    // The tests sync on demand; the regular wake never fires.
    setTimer: () => null,
    clearTimer: () => undefined,
  });
}

beforeEach(() => {
  logged.length = 0;
  for (const k of Object.keys(saved) as (keyof typeof saved)[]) console[k] = (...a: unknown[]) => void logged.push(a);
  entries.clear();
  place = 0;
  pageMax = 2;
  refusal = null;
  requests.length = 0;
  reports.length = 0;
  lock.locked = false;
  dir = join(mkdtempSync(join(tmpdir(), "cbp-sync-")), "class-cache");
  freshApp();
});
afterEach(() => {
  Object.assign(console, saved);
  sync.stop();
  pairing.stop();
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

/** Until the sync that is running has finished. */
async function settled(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (sync.view().status !== "syncing") return;
  }
  throw new Error("sync did not finish");
}
const files = (): string[] => (existsSync(join(dir, CLASSES_DIR)) ? readdirSync(join(dir, CLASSES_DIR)).sort() : []);
const fetchedIds = (): string[] => requests.filter((r) => r.url.startsWith("/api/player/classes/")).map((r) => r.url.slice(-36));
const listedAfter = (): string[] => requests.filter((r) => r.url.startsWith("/api/player/changes")).map((r) => new URL(r.url, origin).searchParams.get("after") ?? "");

/** Nothing logged at all, and no token in an address or a cached file; each only in its header. */
function nothingLeaked(): void {
  assert.deepEqual(logged, []);
  for (const r of requests) {
    for (const t of tokens) assert.ok(!r.url.includes(t));
    assert.ok(tokens.some((t) => r.auth === `Bearer ${t}`));
  }
  const cached = [...files().map((f) => join(dir, CLASSES_DIR, f)), join(dir, SYNC_FILE)].filter((f) => existsSync(f));
  for (const f of cached) for (const t of tokens) assert.ok(!readFileSync(f, "utf8").includes(t));
}

test("first sync, an incremental sync and a removal", async () => {
  publish(ID_A, document("A"));
  publish(ID_B, document("B"));
  publish(ID_C, document("C"));
  linkAndStart(pairing, sync);
  await settled();
  // Two pages of two: every class fetched once, the cursor kept on disk.
  assert.deepEqual(sync.view(), { status: "synced", classes: 3, pinned: null });
  assert.deepEqual(listedAfter(), ["0", "2"]);
  assert.deepEqual(fetchedIds(), [ID_A, ID_B, ID_C]);
  assert.deepEqual(files(), [`${ID_A}.json`, `${ID_B}.json`, `${ID_C}.json`]);
  assert.equal(JSON.parse(readFileSync(join(dir, SYNC_FILE), "utf8")).cursor, 3);

  requests.length = 0;
  publish(ID_B, document("B, second version"));
  sync.syncNow();
  await settled();
  assert.deepEqual(listedAfter(), ["3"]);
  assert.deepEqual(fetchedIds(), [ID_B]);
  assert.equal((classCache(dir).read(ID_B)?.document.class as { title: string }).title, "B, second version");

  publish(ID_C, null);
  sync.syncNow();
  await settled();
  assert.deepEqual(files(), [`${ID_A}.json`, `${ID_B}.json`]);
  assert.equal(sync.view().classes, 2);
  nothingLeaked();
});

test("the class being played is kept during play; the newer version applies after it", async () => {
  publish(ID_A, document("A"));
  linkAndStart(pairing, sync);
  await settled();
  const snapshot = sync.pin(ID_A);
  assert.ok(snapshot !== null);
  const before = structuredClone(snapshot);
  publish(ID_A, document("A, revised"));
  sync.syncNow();
  await settled();
  // The snapshot is untouched; the newer version is in the cache and shown as available.
  assert.deepEqual(snapshot, before);
  assert.deepEqual(sync.view().pinned, { id: ID_A, after: "newer" });
  sync.unpin();
  assert.equal((sync.pin(ID_A)?.class as { title: string }).title, "A, revised");
  assert.deepEqual(sync.view().pinned, { id: ID_A, after: "none" });
  nothingLeaked();
});

test("revoked: the cache and the token are wiped, after the class being played has ended", async () => {
  publish(ID_A, document("A"));
  publish(ID_B, document("B"));
  linkAndStart(pairing, sync);
  await settled();
  assert.ok(sync.pin(ID_A) !== null);
  refusal = { status: 401, body: { error: "token_revoked" } };
  sync.syncNow();
  await settled();
  assert.deepEqual(reports, ["gone"]);
  // The pairing has deleted the token; the cache waits for the class to end.
  assert.equal(pairing.credential(), null);
  assert.equal(pairing.view().state, "unpaired");
  assert.deepEqual(files(), [`${ID_A}.json`, `${ID_B}.json`]);
  sync.unpin();
  assert.equal(existsSync(dir), false);
  assert.deepEqual(sync.view(), { status: "unpaired", classes: 0, pinned: null });
  nothingLeaked();
});

test("revoked with no class playing, and unknown: wiped at once", async () => {
  for (const code of ["token_revoked", "token_unknown"]) {
    publish(ID_A, document("A"));
    refusal = null;
    linkAndStart(pairing, sync);
    await settled();
    assert.deepEqual(files(), [`${ID_A}.json`]);
    refusal = { status: 401, body: { error: code } };
    sync.syncNow();
    await settled();
    assert.equal(existsSync(dir), false, code);
    assert.equal(pairing.credential(), null);
    // A fresh pairing for the next round.
    freshApp();
  }
  nothingLeaked();
});

test("expired: the cache is kept, the pairing says to pair again", async () => {
  publish(ID_A, document("A"));
  linkAndStart(pairing, sync);
  await settled();
  refusal = { status: 401, body: { error: "token_expired" } };
  sync.syncNow();
  await settled();
  assert.deepEqual(reports, ["expired"]);
  assert.deepEqual(files(), [`${ID_A}.json`]);
  assert.equal(sync.view().status, "expired");
  assert.equal(pairing.credential()?.expired, true);
  nothingLeaked();
});

test("offline: the server gone away deletes nothing and the cache still plays", async () => {
  publish(ID_A, document("A"));
  linkAndStart(pairing, sync);
  await settled();
  const unreachable = createSyncService({
    now: () => Date.now(),
    call: async () => ({ kind: "unreachable" }),
    cache: classCache(dir),
    credential: () => credentialOf(pairing),
    report: () => assert.fail("nothing to report"),
    setTimer: () => null,
    clearTimer: () => undefined,
  });
  unreachable.start();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(unreachable.view().status, "offline");
  assert.deepEqual(files(), [`${ID_A}.json`]);
  assert.ok(unreachable.pin(ID_A) !== null);
  unreachable.stop();
  nothingLeaked();
});

/** Deleting the cached classes fails while `locked` is set, as a file held open does on Windows. */
const lock = { locked: false };
const lockable = (path: string, options?: RmOptions): void => {
  if (lock.locked && path.endsWith(CLASSES_DIR)) throw new Error("EBUSY");
  rmSync(path, options);
};
/** What sync asked of the server (the pairing's own device check aside). */
const synced = (): string[] => [...listedAfter(), ...fetchedIds()];

/** Account A synced ID_A and ID_B, then was revoked, and the wipe that followed failed. */
async function revokedWithWipeFailed(): Promise<void> {
  freshApp("ann@example.test", lockable);
  publish(ID_A, document("A"));
  publish(ID_B, document("B"));
  linkAndStart(pairing, sync);
  await settled();
  lock.locked = true;
  refusal = { status: 401, body: { error: "token_revoked" } };
  sync.syncNow();
  await settled();
  assert.equal(pairing.credential(), null);
  // Still on disk, marked to be wiped, and nothing of it is shown or plays.
  assert.deepEqual(files(), [`${ID_A}.json`, `${ID_B}.json`]);
  assert.equal(existsSync(join(dir, WIPE_FILE)), true);
  assert.equal(sync.view().classes, 0);
  assert.equal(sync.pin(ID_A), null);
  // Account B's classes on the server from here on.
  refusal = null;
  entries.clear();
  publish(ID_C, document("C, of account B"));
  requests.length = 0;
}

test("a wipe that failed: the next account to pair syncs nothing until it is done, and sees none of the last one's classes", async () => {
  await revokedWithWipeFailed();
  // Account B pairs while the files are still locked: the wipe is tried again, nothing is asked.
  pairAs("bob@example.test");
  sync.syncNow();
  sync.syncNow();
  await settled();
  assert.deepEqual(synced(), []);
  assert.deepEqual(files(), [`${ID_A}.json`, `${ID_B}.json`]);
  assert.equal(sync.view().classes, 0);
  assert.equal(sync.pin(ID_A), null);
  // Unlocked: the next try wipes, and only then is B synced, from 0.
  lock.locked = false;
  sync.syncNow();
  assert.equal(existsSync(dir), false);
  assert.deepEqual(synced(), []);
  sync.syncNow();
  await settled();
  assert.deepEqual(listedAfter(), ["0"]);
  assert.deepEqual(files(), [`${ID_C}.json`]);
  assert.deepEqual(sync.view(), { status: "synced", classes: 1, pinned: null });
  assert.equal(sync.pin(ID_A), null);
  assert.equal(sync.pin(ID_B), null);
  assert.ok(sync.pin(ID_C) !== null);
  nothingLeaked();
});

test("a restart with a wipe left unfinished wipes first, with or without a pairing", async () => {
  await revokedWithWipeFailed();
  // Restarted with no pairing, the files still locked: nothing loads, the marker stays.
  freshApp(null, lockable);
  linkAndStart(pairing, sync);
  assert.deepEqual(sync.view(), { status: "unpaired", classes: 0, pinned: null });
  assert.equal(sync.pin(ID_A), null);
  assert.equal(existsSync(join(dir, WIPE_FILE)), true);
  // Restarted again, paired to account B, the files free: the wipe is done at start, before B syncs.
  lock.locked = false;
  freshApp("bob@example.test", lockable);
  linkAndStart(pairing, sync);
  assert.equal(existsSync(dir), false);
  assert.deepEqual(synced(), []);
  sync.syncNow();
  await settled();
  assert.deepEqual(files(), [`${ID_C}.json`]);
  assert.equal(sync.pin(ID_A), null);
  assert.ok(sync.pin(ID_C) !== null);
  nothingLeaked();
});
