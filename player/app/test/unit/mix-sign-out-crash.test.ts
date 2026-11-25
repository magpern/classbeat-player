// A sign-out that stops between its steps (issue #709, item 6): the account is marked as ending
// before the key goes, its token counts as gone while the mark is there, and the next start's sweep
// finishes the deletion. The key, then the token, then the folder still go in that order (ADR 0013
// section 1). Against the fake vault and against the real one in a temporary folder.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createMixService } from "../../src/main/mix/service.ts";
import { keychainVault } from "../../src/main/mix/vault.ts";
import type { MixVault } from "../../src/main/mix/vault.ts";
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
  const v = keychainVault(fakeSafe(), d, "linux");
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
