// The offline class cache (main/sync/cache.ts) in a temporary folder: one file per class written
// atomically and readable by this user only, the cursor with its account, a file that does not
// read back is dropped, a document read for play must still have its hash, and the wipe.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { contentHash } from "classformat/src/index.ts";
import { classCache, CLASSES_DIR, SYNC_FILE } from "../../src/main/sync/cache.ts";
import { document, ID_A, ID_B } from "./sync-fixtures.ts";

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
  cache.keep(ID_A, contentHash(doc), doc);
  cache.commit(ACCOUNT, 12);
  assert.deepEqual(cache.read(ID_A), { hash: contentHash(doc), document: doc });
  assert.deepEqual(classCache(dir).load(), { account: ACCOUNT, cursor: 12, held: new Map([[ID_A, contentHash(doc)]]) });
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
  cache.keep(ID_A, contentHash(v1), v1);
  cache.keep(ID_A, contentHash(v2), v2);
  assert.deepEqual(cache.read(ID_A)?.document, v2);
  cache.remove([ID_A, ID_B]);
  assert.equal(existsSync(join(dir, CLASSES_DIR, `${ID_A}.json`)), false);
  assert.equal(cache.read(ID_A), null);
});

test("a document that no longer has its hash is not read for play", () => {
  const cache = classCache(dir);
  const doc = document();
  cache.keep(ID_A, contentHash(doc), doc);
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
  assert.deepEqual(classCache(dir).load(), { account: null, cursor: 0, held: new Map() });
  assert.deepEqual(readdirSync(classes), ["notes.txt"]);
});

test("only the contract's class ids name a file", () => {
  const cache = classCache(dir);
  const doc = document();
  for (const id of ["../sync", "..", "11111111-1111-4111-8111-11111111111X", `${ID_A}/x`]) {
    assert.throws(() => cache.keep(id, contentHash(doc), doc));
    assert.throws(() => cache.remove([id]));
    assert.equal(cache.read(id), null);
  }
  assert.throws(() => cache.keep(ID_A, "sha256:short", doc));
  assert.throws(() => cache.commit("../x", 1));
  assert.throws(() => cache.commit(ACCOUNT, -1));
});

test("a link planted in place of a class file is not followed when read", { skip: !posix }, () => {
  const cache = classCache(dir);
  const doc = document();
  const elsewhere = join(dir, "..", "elsewhere.json");
  writeFileSync(elsewhere, JSON.stringify({ v: 1, hash: contentHash(doc), document: doc }));
  mkdirSync(join(dir, CLASSES_DIR), { recursive: true });
  symlinkSync(elsewhere, join(dir, CLASSES_DIR, `${ID_A}.json`));
  assert.equal(cache.read(ID_A), null);
});

test("the wipe deletes every class and the cursor", () => {
  const cache = classCache(dir);
  const doc = document();
  cache.keep(ID_A, contentHash(doc), doc);
  cache.commit(ACCOUNT, 1);
  cache.wipe();
  assert.equal(existsSync(dir), false);
  assert.deepEqual(cache.load(), { account: null, cursor: 0, held: new Map() });
  cache.wipe();
});
