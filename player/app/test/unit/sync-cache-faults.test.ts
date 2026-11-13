// The offline class cache (main/sync/cache.ts) when the disk does not do what was asked: a delete
// that leaves a file behind without saying so, a file or folder that cannot be read, and a number
// past what a double holds exactly. A fault decides nothing and deletes nothing.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { RmOptions } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { contentHash } from "classformat/src/index.ts";
import { readCapped } from "../../src/main/capped-read.ts";
import { classCache, CLASSES_DIR, SYNC_FILE, WIPE_FILE } from "../../src/main/sync/cache.ts";
import { document, ID_A, ID_B } from "./sync-fixtures.ts";

const ACCOUNT = "c".repeat(64);
let dir: string;
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "cbp-cache-faults-")), "class-cache");
});
afterEach(() => rmSync(join(dir, ".."), { recursive: true, force: true }));

const posix = process.platform !== "win32";
const classFile = (id: string): string => join(dir, CLASSES_DIR, `${id}.json`);

/** A cache of ACCOUNT with two classes and a cursor; every file's bytes, to show none changed. */
function filled(): Map<string, string> {
  const cache = classCache(dir);
  const a = document("A");
  const b = document("B");
  cache.keep(ACCOUNT, ID_A, contentHash(a), a);
  cache.keep(ACCOUNT, ID_B, contentHash(b), b);
  cache.commit(ACCOUNT, 5);
  return snapshot();
}
function snapshot(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of [join(dir, SYNC_FILE), classFile(ID_A), classFile(ID_B)]) if (existsSync(f)) out.set(f, readFileSync(f, "utf8"));
  return out;
}

/** A read that fails as a disk does (EIO) for the files `faulty` matches while `on` is set. */
function faultyReader(faulty: (file: string) => boolean) {
  const fault = { on: true };
  const read = (file: string, max: number): Buffer | null => {
    if (fault.on && faulty(file)) throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
    return readCapped(file, max);
  };
  return { fault, read };
}

test("a delete that leaves a class behind without saying so: the wipe throws and stays pending", () => {
  const doc = document();
  const leaky = { on: true };
  // Reports success for the class folder and the cache folder, and deletes neither.
  const remove = (path: string, options?: RmOptions): void => {
    if (leaky.on && (path.endsWith(CLASSES_DIR) || path === dir)) return;
    rmSync(path, options);
  };
  const cache = classCache(dir, remove);
  cache.keep(ACCOUNT, ID_A, contentHash(doc), doc);
  cache.commit(ACCOUNT, 1);
  assert.throws(() => cache.wipe(), /not wiped/);
  assert.equal(existsSync(join(dir, WIPE_FILE)), true);
  assert.equal(existsSync(classFile(ID_A)), true);
  // Still pending, after a restart too: nothing loads, plays, keeps or commits.
  const again = classCache(dir, remove);
  assert.deepEqual(again.load(), { account: null, cursor: 0, held: new Map(), wipePending: true });
  assert.equal(again.read(ID_A), null);
  assert.throws(() => again.keep(ACCOUNT, ID_B, contentHash(doc), doc));
  assert.throws(() => again.commit(ACCOUNT, 2));
  leaky.on = false;
  again.wipe();
  assert.equal(existsSync(dir), false);
});

test("the cursor file cannot be read: the load throws, and every file stays until it can", () => {
  const before = filled();
  const { fault, read } = faultyReader((f) => f.endsWith(SYNC_FILE));
  const cache = classCache(dir, rmSync, read);
  assert.throws(() => cache.load(), /EIO/);
  assert.deepEqual(snapshot(), before);
  assert.equal(existsSync(join(dir, WIPE_FILE)), false);
  fault.on = false;
  assert.deepEqual(cache.load(), { account: ACCOUNT, cursor: 5, held: new Map([[ID_A, contentHash(document("A"))], [ID_B, contentHash(document("B"))]]), wipePending: false });
});

test("a class file cannot be read: the load throws, and the file is not dropped", () => {
  const before = filled();
  const { fault, read } = faultyReader((f) => f === classFile(ID_A));
  const cache = classCache(dir, rmSync, read);
  assert.throws(() => cache.load(), /EIO/);
  assert.deepEqual(snapshot(), before);
  // Read for play it is simply not there; nothing is deleted for it either.
  assert.equal(cache.read(ID_A), null);
  assert.deepEqual(snapshot(), before);
  fault.on = false;
  assert.equal(cache.load().held.size, 2);
});

test("the class folder cannot be listed: the load throws, and nothing is deleted", () => {
  const before = filled();
  // A file where the folder should be (ENOTDIR): not a missing folder, so not an empty cache.
  rmSync(join(dir, CLASSES_DIR), { recursive: true });
  writeFileSync(join(dir, CLASSES_DIR), "not a folder");
  assert.throws(() => classCache(dir).load());
  assert.equal(readFileSync(join(dir, CLASSES_DIR), "utf8"), "not a folder");
  assert.equal(readFileSync(join(dir, SYNC_FILE), "utf8"), before.get(join(dir, SYNC_FILE)));
});

test("a missing cursor file is no cursor, and a link in its place is not one: classes without one are wiped", () => {
  filled();
  rmSync(join(dir, SYNC_FILE));
  assert.deepEqual(classCache(dir).load(), { account: null, cursor: 0, held: new Map(), wipePending: true });
  if (!posix) return;
  const elsewhere = join(dir, "..", "sync-elsewhere.json");
  writeFileSync(elsewhere, JSON.stringify({ v: 1, account: ACCOUNT, cursor: 5 }));
  symlinkSync(elsewhere, join(dir, SYNC_FILE));
  assert.deepEqual(classCache(dir).load(), { account: null, cursor: 0, held: new Map(), wipePending: true });
});

test("a cursor past 2^53 is neither kept nor loaded as one", () => {
  filled();
  const cache = classCache(dir);
  assert.throws(() => cache.commit(ACCOUNT, 2 ** 53));
  writeFileSync(join(dir, SYNC_FILE), `{"v":1,"account":"${ACCOUNT}","cursor":9007199254740993}`);
  assert.deepEqual(cache.load(), { account: null, cursor: 0, held: new Map(), wipePending: true });
  assert.deepEqual(readdirSync(join(dir, CLASSES_DIR)).sort(), [`${ID_A}.json`, `${ID_B}.json`]);
});
