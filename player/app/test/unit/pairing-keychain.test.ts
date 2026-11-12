// The keychain store (main/pairing/keychain.ts) with a fake safeStorage in a temporary folder:
// only a real keychain counts, what is written is the encrypted text only, readable by this user
// only, and without a keychain nothing is written at all.
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { keychainUsable } from "../../src/core/pairing/keychain-policy.ts";
import { keychainStore, MAX_FILE_BYTES, RECORD_FILE } from "../../src/main/pairing/keychain.ts";
import type { SafeStorageLike } from "../../src/main/pairing/keychain.ts";
import { newToken } from "./pairing-tokens.ts";

/** Encrypts by reversing and XOR-ing, enough to show the plain text never reaches the disk. */
function fakeSafe(available = true, backend = "gnome_libsecret"): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (t) => Buffer.from(Buffer.from(t, "utf8").map((b) => b ^ 0x5a)).reverse(),
    decryptString: (d) => Buffer.from(Buffer.from(d).reverse().map((b) => b ^ 0x5a)).toString("utf8"),
  };
}

const dir = (): string => mkdtempSync(join(tmpdir(), "pairing-keychain-"));

test("which keychains count: Keychain, DPAPI, the Secret Service and KWallet; never basic_text", () => {
  assert.equal(keychainUsable("darwin", true, null), true);
  assert.equal(keychainUsable("win32", true, null), true);
  for (const b of ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]) assert.equal(keychainUsable("linux", true, b), true, b);
  for (const b of ["basic_text", "unknown", null]) assert.equal(keychainUsable("linux", true, b), false, String(b));
  assert.equal(keychainUsable("darwin", false, null), false);
  assert.equal(keychainUsable("freebsd", true, "gnome_libsecret"), false);
});

test("saved encrypted, mode 0600, read back, and deleted by clear", () => {
  const d = dir();
  const s = keychainStore(fakeSafe(), d, "linux");
  const token = newToken("dev");
  const text = JSON.stringify({ token });
  s.save(text);
  const file = join(d, RECORD_FILE);
  assert.ok(!readFileSync(file).toString("latin1").includes(token), "the token is on disk in the clear");
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(s.load(), text);
  assert.deepEqual(readdirSync(d), [RECORD_FILE], "no temporary file is left");
  s.clear();
  assert.equal(existsSync(file), false);
  assert.equal(s.load(), null);
});

test("no keychain (basic_text, or none at all): not available, nothing is written, nothing is read", () => {
  for (const safe of [fakeSafe(true, "basic_text"), fakeSafe(false)]) {
    const d = dir();
    const s = keychainStore(safe, d, "linux");
    assert.equal(s.available(), false);
    assert.throws(() => s.save("x"));
    assert.deepEqual(readdirSync(d), []);
    assert.equal(s.load(), null);
  }
});

test("a safeStorage that throws counts as no keychain; a broken file reads as nothing", () => {
  const throwing = { ...fakeSafe(), isEncryptionAvailable: () => { throw new Error("no"); } };
  assert.equal(keychainStore(throwing, dir(), "linux").available(), false);
  const d = dir();
  const broken = { ...fakeSafe(), decryptString: () => { throw new Error("bad"); } };
  keychainStore(fakeSafe(), d, "linux").save("x");
  assert.equal(keychainStore(broken, d, "linux").load(), null);
});

const notOnWindows = { skip: process.platform === "win32" ? "symbolic links need extra rights on Windows" : false };

test("a link planted at the temporary file's name is removed, never followed", notOnWindows, () => {
  const d = dir();
  const target = join(dir(), "elsewhere");
  writeFileSync(target, "untouched");
  symlinkSync(target, join(d, `${RECORD_FILE}.tmp`));
  keychainStore(fakeSafe(), d, "linux").save("x");
  assert.equal(readFileSync(target, "utf8"), "untouched");
  assert.ok(lstatSync(join(d, RECORD_FILE)).isFile());
  assert.deepEqual(readdirSync(d), [RECORD_FILE]);
});

test("a link that appears at the temporary name after the removal makes the save fail, not follow it", notOnWindows, () => {
  const d = dir();
  const target = join(dir(), "elsewhere");
  writeFileSync(target, "untouched");
  const store = keychainStore(fakeSafe(), d, "linux");
  store.save("first");
  // encryptString runs between the removal and the exclusive create: the worst moment for a race.
  const racing: SafeStorageLike = {
    ...fakeSafe(),
    encryptString: (t) => {
      symlinkSync(target, join(d, `${RECORD_FILE}.tmp`));
      return fakeSafe().encryptString(t);
    },
  };
  assert.throws(() => keychainStore(racing, d, "linux").save("second"));
  assert.equal(readFileSync(target, "utf8"), "untouched");
  assert.equal(store.load(), "first");
  assert.deepEqual(readdirSync(d), [RECORD_FILE]);
});

test("a file over the size limit is refused unread; one at the limit is read", () => {
  const d = dir();
  let decrypted = 0;
  const counting: SafeStorageLike = {
    ...fakeSafe(),
    decryptString: () => {
      decrypted += 1;
      return "x";
    },
  };
  writeFileSync(join(d, RECORD_FILE), Buffer.alloc(MAX_FILE_BYTES + 1));
  assert.equal(keychainStore(counting, d, "linux").load(), null);
  assert.equal(decrypted, 0);
  writeFileSync(join(d, RECORD_FILE), Buffer.alloc(MAX_FILE_BYTES));
  assert.equal(keychainStore(counting, d, "linux").load(), "x");
  assert.equal(decrypted, 1);
});

test("a record file that is a link or not a plain file is read as nothing", notOnWindows, () => {
  const real = dir();
  keychainStore(fakeSafe(), real, "linux").save("x");
  const linked = dir();
  symlinkSync(join(real, RECORD_FILE), join(linked, RECORD_FILE));
  assert.equal(keychainStore(fakeSafe(), linked, "linux").load(), null);
  const folder = dir();
  mkdirSync(join(folder, RECORD_FILE));
  assert.equal(keychainStore(fakeSafe(), folder, "linux").load(), null);
});
