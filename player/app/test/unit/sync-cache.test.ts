// The offline class cache (main/sync/cache.ts) in a temporary folder: one file per class written
// atomically and readable by this user only, the cursor with its account, a file that does not
// read back is dropped, a document read for play must still have its hash, every class stamped with
// its account, and the wipe, which keeps a marker on disk until nothing else is left.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import type { RmOptions } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { contentHash } from "classformat/src/index.ts";
import { classCache, CLASSES_DIR, SYNC_FILE, WIPE_FILE } from "../../src/main/sync/cache.ts";
import { document, ID_A, ID_B, STAMP } from "./sync-fixtures.ts";

const ACCOUNT = "c".repeat(64);
let dir: string;
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "cbp-cache-")), "class-cache");
});
afterEach(() => rmSync(join(dir, ".."), { recursive: true, force: true }));

const posix = process.platform !== "win32";

test("a class kept is read back with its hash, and loads as held, with the cursor", () => {
  const cache = classCache(dir);
  const doc = document();
  cache.keep(ACCOUNT, ID_A, contentHash(doc), doc, STAMP);
  cache.commit(ACCOUNT, 12);
  assert.deepEqual(cache.read(ID_A), { account: ACCOUNT, hash: contentHash(doc), publishedAt: STAMP, document: doc });
  assert.deepEqual(classCache(dir).load(), { account: ACCOUNT, cursor: 12, held: new Map([[ID_A, contentHash(doc)]]), published: new Map([[ID_A, STAMP]]), wipePending: false });
  if (posix) {
    assert.equal(statSync(join(dir, CLASSES_DIR, `${ID_A}.json`)).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, SYNC_FILE)).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, CLASSES_DIR)).mode & 0o777, 0o700);
  }
  // No temporary file is left behind.
  assert.deepEqual(readdirSync(join(dir, CLASSES_DIR)), [`${ID_A}.json`]);
});

test("a newer version replaces the file whole; a removal deletes it at once", () => {
  const cache = classCache(dir);
  const v1 = document("One");
  const v2 = document("Two");
  cache.keep(ACCOUNT, ID_A, contentHash(v1), v1, STAMP);
  cache.keep(ACCOUNT, ID_A, contentHash(v2), v2, STAMP);
  assert.deepEqual(cache.read(ID_A)?.document, v2);
  cache.remove([ID_A, ID_B]);
  assert.equal(existsSync(join(dir, CLASSES_DIR, `${ID_A}.json`)), false);
  assert.equal(cache.read(ID_A), null);
});

test("a document that no longer has its hash is not read for play", () => {
  const cache = classCache(dir);
  const doc = document();
  cache.keep(ACCOUNT, ID_A, contentHash(doc), doc, STAMP);
  const file = join(dir, CLASSES_DIR, `${ID_A}.json`);
  writeFileSync(file, readFileSync(file, "utf8").replace("Quick spin", "Changed"));
  assert.equal(cache.read(ID_A), null);
});

test("at load, a file that does not read back and a leftover temporary file are dropped; others are left", () => {
  const classes = join(dir, CLASSES_DIR);
  mkdirSync(classes, { recursive: true });
  writeFileSync(join(classes, `${ID_A}.json`), "{not json");
  writeFileSync(join(classes, `${ID_B}.json`), JSON.stringify({ v: 2, hash: `sha256:${"0".repeat(64)}`, document: {} }));
  writeFileSync(join(classes, `${ID_A}.json.tmp`), "partial");
  writeFileSync(join(classes, "notes.txt"), "x");
  writeFileSync(join(dir, SYNC_FILE), JSON.stringify({ v: 1, account: "not-a-key", cursor: 3 }));
  assert.deepEqual(classCache(dir).load(), { account: null, cursor: 0, held: new Map(), published: new Map(), wipePending: false });
  assert.deepEqual(readdirSync(classes), ["notes.txt"]);
});

test("only the contract's class ids name a file", () => {
  const cache = classCache(dir);
  const doc = document();
  for (const id of ["../sync", "..", "11111111-1111-4111-8111-11111111111X", `${ID_A}/x`]) {
    assert.throws(() => cache.keep(ACCOUNT, id, contentHash(doc), doc, STAMP));
    assert.throws(() => cache.remove([id]));
    assert.equal(cache.read(id), null);
  }
  assert.throws(() => cache.keep(ACCOUNT, ID_A, "sha256:short", doc, STAMP));
  assert.throws(() => cache.keep("../x", ID_A, contentHash(doc), doc, STAMP));
  assert.throws(() => cache.commit("../x", 1));
  assert.throws(() => cache.commit(ACCOUNT, -1));
});

test("a link planted in place of a class file is not followed when read", { skip: !posix }, () => {
  const cache = classCache(dir);
  const doc = document();
  const elsewhere = join(dir, "..", "elsewhere.json");
  writeFileSync(elsewhere, JSON.stringify({ v: 1, account: ACCOUNT, hash: contentHash(doc), document: doc }));
  mkdirSync(join(dir, CLASSES_DIR), { recursive: true });
  symlinkSync(elsewhere, join(dir, CLASSES_DIR, `${ID_A}.json`));
  assert.equal(cache.read(ID_A), null);
});

test("the wipe deletes every class and the cursor", () => {
  const cache = classCache(dir);
  const doc = document();
  cache.keep(ACCOUNT, ID_A, contentHash(doc), doc, STAMP);
  cache.commit(ACCOUNT, 1);
  cache.wipe();
  assert.equal(existsSync(dir), false);
  assert.deepEqual(cache.load(), { account: null, cursor: 0, held: new Map(), published: new Map(), wipePending: false });
  cache.wipe();
});

test("a cache that is not one account's is never loaded: another account's class, or classes with no cursor", () => {
  const doc = document();
  const a = classCache(dir);
  a.keep("d".repeat(64), ID_A, contentHash(doc), doc, STAMP);
  // Classes with no cursor of their account on record.
  assert.deepEqual(classCache(dir).load(), { account: null, cursor: 0, held: new Map(), published: new Map(), wipePending: true });
  // A cursor of one account and a class of another.
  a.commit(ACCOUNT, 4);
  a.keep(ACCOUNT, ID_B, contentHash(doc), doc, STAMP);
  assert.deepEqual(classCache(dir).load(), { account: null, cursor: 0, held: new Map(), published: new Map(), wipePending: true });
});

/** A delete that fails for the class files while `locked` is set, as a file held open does on Windows. */
function lockable() {
  const lock = { locked: true };
  const remove = (path: string, options?: RmOptions): void => {
    if (lock.locked && (path.endsWith(CLASSES_DIR) || path.endsWith(".json")) && !path.endsWith(SYNC_FILE)) throw new Error("EBUSY");
    rmSync(path, options);
  };
  return { lock, remove };
}

test("a wipe that fails leaves its marker: nothing loads, keeps, commits or reads until a wipe succeeds", () => {
  const doc = document();
  const { lock, remove } = lockable();
  const cache = classCache(dir, remove);
  cache.keep(ACCOUNT, ID_A, contentHash(doc), doc, STAMP);
  cache.commit(ACCOUNT, 1);
  assert.throws(() => cache.wipe());
  assert.equal(existsSync(join(dir, WIPE_FILE)), true);
  assert.equal(existsSync(join(dir, CLASSES_DIR, `${ID_A}.json`)), true);
  // After a restart too: the marker is on disk.
  const again = classCache(dir, remove);
  assert.deepEqual(again.load(), { account: null, cursor: 0, held: new Map(), published: new Map(), wipePending: true });
  assert.equal(again.read(ID_A), null);
  assert.throws(() => again.keep(ACCOUNT, ID_B, contentHash(doc), doc, STAMP));
  assert.throws(() => again.commit(ACCOUNT, 2));
  lock.locked = false;
  again.wipe();
  assert.equal(existsSync(dir), false);
  assert.deepEqual(again.load(), { account: null, cursor: 0, held: new Map(), published: new Map(), wipePending: false });
});

test("an existing cache folder made wider is tightened to this user only", { skip: !posix }, () => {
  mkdirSync(join(dir, CLASSES_DIR), { recursive: true, mode: 0o755 });
  chmodSync(dir, 0o755);
  chmodSync(join(dir, CLASSES_DIR), 0o755);
  classCache(dir).load();
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, CLASSES_DIR)).mode & 0o777, 0o700);
  chmodSync(join(dir, CLASSES_DIR), 0o755);
  const doc = document();
  classCache(dir).keep(ACCOUNT, ID_A, contentHash(doc), doc, STAMP);
  assert.equal(statSync(join(dir, CLASSES_DIR)).mode & 0o777, 0o700);
});

test("the publication time is kept in the class file, and read back at load and for play", () => {
  const cache = classCache(dir);
  const doc = document("A");
  cache.keep(ACCOUNT, ID_A, contentHash(doc), doc, "2026-11-05T08:30:00+00:00");
  cache.commit(ACCOUNT, 1);
  const file = JSON.parse(readFileSync(join(dir, CLASSES_DIR, `${ID_A}.json`), "utf8")) as Record<string, unknown>;
  assert.equal(file.published_at, "2026-11-05T08:30:00+00:00");
  assert.deepEqual([...classCache(dir).load().published], [[ID_A, "2026-11-05T08:30:00+00:00"]]);
  assert.equal(cache.read(ID_A)?.publishedAt, "2026-11-05T08:30:00+00:00");
  // A time that is not one is never kept.
  assert.throws(() => cache.keep(ACCOUNT, ID_A, contentHash(doc), doc, "yesterday"));
});

test("a class file from before the time was kept still loads: held, with the time unknown", () => {
  const doc = document("A");
  mkdirSync(join(dir, CLASSES_DIR), { recursive: true });
  writeFileSync(join(dir, SYNC_FILE), JSON.stringify({ v: 1, account: ACCOUNT, cursor: 3 }));
  writeFileSync(join(dir, CLASSES_DIR, `${ID_A}.json`), JSON.stringify({ v: 1, account: ACCOUNT, hash: contentHash(doc), document: doc }));
  // A malformed time leaves the time unknown too; the class is not dropped for it.
  writeFileSync(join(dir, CLASSES_DIR, `${ID_B}.json`), JSON.stringify({ v: 1, account: ACCOUNT, hash: contentHash(doc), document: doc, published_at: 7 }));
  const loaded = classCache(dir).load();
  assert.deepEqual(loaded, { account: ACCOUNT, cursor: 3, held: new Map([[ID_A, contentHash(doc)], [ID_B, contentHash(doc)]]), published: new Map(), wipePending: false });
  assert.equal(classCache(dir).read(ID_A)?.publishedAt, null);
  assert.equal(classCache(dir).read(ID_A)?.document.format_version, doc.format_version);
});
