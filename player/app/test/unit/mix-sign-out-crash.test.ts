// A sign-out that stops between its steps (issue #709, item 6): the account is marked as ending
// before the key goes, its token counts as gone while the mark is there, and the next start's sweep
// finishes the deletion. The key, then the token, then the folder still go in that order (ADR 0013
// section 1). A mark that cannot be made, or flushed to disk, deletes nothing: the sign-out did not
// finish and the account still shows connected (#720). Against the fake vault and against the real
// one in a temporary folder.
import assert from "node:assert/strict";
import { existsSync, fstatSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createMixService } from "../../src/main/mix/service.ts";
import { keychainVault } from "../../src/main/mix/vault.ts";
import type { Flush, MixVault } from "../../src/main/mix/vault.ts";
import { FAKE_TOKEN, FakeMixSource } from "./fake-mix-source.ts";
import { ACCT, fakeSafe, fakeVault, OTHER } from "./mix-fakes.ts";

const TYPED = { username: "ana.k", password: "SENTINEL-pw-7f3a9c" };
const start = (vault: MixVault, source = new FakeMixSource(new Uint8Array(8))) => createMixService({ source, vault, account: () => ACCT });

test("a token left behind by a sign-out that stopped after the key is not shown as connected, in this run or the next", async () => {
  const vault = fakeVault();
  const first = start(vault);
  await first.signIn(TYPED);
  vault.keys.add(ACCT);
  vault.folders.add(ACCT);
  // The token's deletion does not happen (the closest a test gets to the process ending there).
  vault.failStep = "clearToken";
  assert.equal((await first.signOut())?.state, "signed_out");
  assert.equal(vault.tokens.get(ACCT), FAKE_TOKEN, "the token is still in the keychain");
  assert.equal(first.view().state, "signed_out");
  assert.equal(first.view().needsReconnect, false);
  // The next start: signed out before the sweep, and the sweep finishes the deletion.
  vault.failStep = null;
  vault.log.length = 0;
  const next = start(vault);
  assert.equal(next.view().state, "signed_out");
  next.sweep();
  assert.deepEqual(vault.log, ["markEnding a", "clearKey a", "clearToken a", "removeFolder a", "clearEnding a"]);
  assert.deepEqual(vault.accounts(), []);
  assert.equal(next.view().state, "signed_out");
});

test("a sign-in for an account whose ending did not finish finishes it first, and sends nothing while it cannot", async () => {
  const vault = fakeVault();
  vault.tokens.set(ACCT, "old-token");
  vault.keys.add(ACCT);
  vault.folders.add(ACCT);
  vault.ending.add(ACCT);
  vault.failStep = "clearToken";
  const source = new FakeMixSource(new Uint8Array(8));
  const service = start(vault, source);
  assert.equal(service.view().state, "signed_out");
  assert.equal(await service.signIn(TYPED), null);
  assert.deepEqual(source.calls, [], "the details were not sent");
  assert.equal(vault.keys.has(ACCT) || vault.folders.has(ACCT), false, "the old key and mixes are gone");
  vault.failStep = null;
  assert.equal((await service.signIn(TYPED))?.state, "signed_in");
  assert.equal(vault.ending.has(ACCT), false);
  assert.equal(vault.tokens.get(ACCT), FAKE_TOKEN);
  // Restarted, the new token is kept: the mark is gone.
  const next = start(vault);
  next.sweep();
  assert.equal(next.view().state, "signed_in");
});

test("the real vault: a marked account's token reads as none, the mark is found as an account, and the sweep clears both", () => {
  const d = mkdtempSync(join(tmpdir(), "mix-crash-"));
  // The real flush runs here, so the vault is told the real system: Windows cannot flush a folder.
  const v = keychainVault(fakeSafe(), d, process.platform === "win32" ? "win32" : "linux");
  v.saveToken(ACCT, FAKE_TOKEN);
  v.markEnding(ACCT);
  v.markEnding(ACCT);
  assert.equal(v.isEnding(ACCT), true);
  assert.equal(v.loadToken(ACCT), null);
  assert.equal(readFileSync(join(d, `mix-ending-${ACCT}.bin`)).length, 0, "the mark holds nothing");
  v.markEnding(OTHER);
  assert.deepEqual(v.accounts(), [ACCT, OTHER]);
  const service = start(v);
  assert.equal(service.view().state, "signed_out");
  service.sweep();
  assert.deepEqual(v.accounts(), []);
  assert.equal(existsSync(join(d, `mix-token-${ACCT}.bin`)), false);
  assert.throws(() => v.markEnding("../x"));
});

test("the real vault never writes through a link planted where the mark goes", { skip: process.platform === "win32" }, () => {
  const d = mkdtempSync(join(tmpdir(), "mix-crash-"));
  const target = join(d, "target.txt");
  writeFileSync(target, "keep me");
  symlinkSync(target, join(d, `mix-ending-${ACCT}.bin`));
  assert.throws(() => keychainVault(fakeSafe(), d, "linux").markEnding(ACCT));
  assert.equal(readFileSync(target, "utf8"), "keep me");
});

test("a mark that cannot be made deletes nothing: the sign-out did not finish and says so", async () => {
  const vault = fakeVault();
  const source = new FakeMixSource(new Uint8Array(8));
  const service = start(vault, source);
  await service.signIn(TYPED);
  vault.keys.add(ACCT);
  vault.folders.add(ACCT);
  vault.log.length = 0;
  vault.failStep = "markEnding";
  const after = await service.signOut();
  assert.equal(after?.state, "signed_in", "still connected: the sign-out did not finish");
  assert.equal(after?.signingOut, false);
  assert.deepEqual(vault.log, ["markEnding a"], "nothing deleted without the mark");
  assert.equal(vault.tokens.get(ACCT), FAKE_TOKEN);
  assert.ok(vault.keys.has(ACCT) && vault.folders.has(ACCT));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(source.calls.filter((c) => c === "signOut"), [], "the kept token is not dropped at the source");
  // Unpaired: still nothing without the mark.
  await service.forgotten();
  assert.deepEqual(vault.log, ["markEnding a", "markEnding a"]);
  // The next start with no pairing: its sweep deletes nothing without the mark either.
  createMixService({ source, vault, account: () => null }).sweep();
  assert.deepEqual(vault.log, ["markEnding a", "markEnding a", "markEnding a"]);
  assert.ok(vault.tokens.has(ACCT) && vault.keys.has(ACCT) && vault.folders.has(ACCT));
  // Once the mark can be made, the sign-out finishes.
  vault.failStep = null;
  assert.equal((await start(vault).signOut())?.state, "signed_out");
  assert.deepEqual(vault.accounts(), []);
});

test("the real vault: the mark is made with mode 0600", { skip: process.platform === "win32" }, () => {
  const d = mkdtempSync(join(tmpdir(), "mix-crash-"));
  // No umask between the mode asked and the one on disk: a wider mode would show.
  const was = process.umask(0);
  try {
    keychainVault(fakeSafe(), d, "linux").markEnding(ACCT);
  } finally {
    process.umask(was);
  }
  assert.equal(statSync(join(d, `mix-ending-${ACCT}.bin`)).mode & 0o777, 0o600);
});

test("the real vault: the mark and then its folder are flushed to disk before markEnding returns", { skip: process.platform === "win32" }, () => {
  const d = mkdtempSync(join(tmpdir(), "mix-crash-"));
  const flushed: string[] = [];
  const flush: Flush = (fd) => {
    const st = fstatSync(fd);
    flushed.push(st.isDirectory() ? `dir ${st.ino === statSync(d).ino}` : `file ${st.ino === statSync(join(d, `mix-ending-${ACCT}.bin`)).ino}`);
  };
  keychainVault(fakeSafe(), d, "linux", flush).markEnding(ACCT);
  assert.deepEqual(flushed, ["file true", "dir true"]);
  // On Windows a folder cannot be opened to flush it: only the mark is.
  const w = mkdtempSync(join(tmpdir(), "mix-crash-"));
  flushed.length = 0;
  keychainVault(fakeSafe(), w, "win32", (fd) => void flushed.push(fstatSync(fd).isDirectory() ? "dir" : "file")).markEnding(ACCT);
  assert.deepEqual(flushed, ["file"]);
});

// The folder case only where a folder can be opened to flush it: on Windows opening one fails before
// the injected flush is reached, so that case would pass without testing the flush (#729).
const FLUSHED = process.platform === "win32" ? ["file"] : ["file", "dir"];

test("the real vault: a mark that cannot be flushed fails the sign-out, nothing is deleted, and the mark goes again", async () => {
  for (const failing of FLUSHED) {
    const d = mkdtempSync(join(tmpdir(), "mix-crash-"));
    let failed = 0;
    const flush: Flush = (fd) => {
      if ((fstatSync(fd).isDirectory() ? "dir" : "file") !== failing) return;
      failed += 1;
      throw new Error("EIO");
    };
    const v = keychainVault(fakeSafe(), d, "linux", flush);
    const service = start(v);
    await service.signIn(TYPED);
    v.createKey(ACCT);
    mkdirSync(join(d, "mixes", ACCT), { recursive: true });
    assert.equal((await service.signOut())?.state, "signed_in", failing);
    assert.equal(failed, 1, `${failing}: the injected flush was reached`);
    assert.equal(v.loadKey(ACCT) !== null, true, failing);
    assert.equal(existsSync(join(d, `mix-token-${ACCT}.bin`)), true, failing);
    assert.equal(existsSync(join(d, "mixes", ACCT)), true, failing);
    // The mark made for this sign-out is gone: the token still reads as kept, and a restart's sweep
    // deletes nothing, so the token is never dropped locally without being dropped at Swedebeat.
    assert.equal(existsSync(join(d, `mix-ending-${ACCT}.bin`)), false, failing);
    assert.equal(v.isEnding(ACCT), false, failing);
    assert.equal(v.loadToken(ACCT), FAKE_TOKEN, failing);
    const next = start(v);
    next.sweep();
    assert.equal(next.view().state, "signed_in", failing);
    assert.equal(v.loadKey(ACCT) !== null, true, failing);
    assert.equal(existsSync(join(d, "mixes", ACCT)), true, failing);
  }
});

test("the real vault: a mark from an unfinished deletion stays when it cannot be flushed again", () => {
  for (const failing of FLUSHED) {
    const d = mkdtempSync(join(tmpdir(), "mix-crash-"));
    keychainVault(fakeSafe(), d, "linux").markEnding(ACCT);
    const v = keychainVault(fakeSafe(), d, "linux", (fd) => {
      if ((fstatSync(fd).isDirectory() ? "dir" : "file") === failing) throw new Error("EIO");
    });
    assert.throws(() => v.markEnding(ACCT), /EIO/, failing);
    assert.equal(v.isEnding(ACCT), true, failing);
  }
});
