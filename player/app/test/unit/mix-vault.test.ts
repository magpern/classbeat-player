// Where Swedebeat's secrets live (main/mix/vault.ts), with a fake safeStorage in a temporary folder,
// and the whole sign-in run against it: the token is kept encrypted only, the password nowhere,
// no path is built from anything but a 64-hex account key, and without a keychain nothing is written.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createMixService } from "../../src/main/mix/service.ts";
import { keychainVault, MAX_TOKEN_BYTES } from "../../src/main/mix/vault.ts";
import { FAKE_TOKEN, FakeMixSource } from "./fake-mix-source.ts";
import { ACCT, fakeSafe, OTHER } from "./mix-fakes.ts";

const PASSWORD = "SENTINEL-pw-7f3a9c";
const dir = (): string => mkdtempSync(join(tmpdir(), "mix-vault-"));

/** Every file under `d`, recursively, with its bytes. */
function files(d: string): [string, Buffer][] {
  return readdirSync(d, { recursive: true, encoding: "utf8" })
    .map((n) => join(d, n))
    .filter((p) => statSync(p).isFile())
    .map((p) => [p, readFileSync(p)]);
}

test("a whole sign-in on the real vault: the token is on disk encrypted, the password nowhere, not even encrypted", async () => {
  const d = dir();
  const safe = fakeSafe();
  const service = createMixService({ source: new FakeMixSource(new Uint8Array(4)), vault: keychainVault(safe, d, "linux"), account: () => ACCT });
  assert.equal((await service.signIn({ username: "ana.k", password: PASSWORD }))?.state, "signed_in");
  const written = files(d);
  assert.deepEqual(written.map(([p]) => p), [join(d, `mix-token-${ACCT}.bin`)]);
  for (const [p, bytes] of written) {
    assert.ok(!bytes.toString("latin1").includes(FAKE_TOKEN), `${p}: the token in the clear`);
    assert.ok(!bytes.toString("latin1").includes(PASSWORD), `${p}: the password in the clear`);
    assert.ok(!safe.decryptString(bytes).includes(PASSWORD), `${p}: the password, encrypted`);
    if (process.platform !== "win32") assert.equal(statSync(p).mode & 0o777, 0o600);
  }
  assert.equal(keychainVault(safe, d, "linux").loadToken(ACCT), FAKE_TOKEN);
});

test("without a real keychain nothing is written and no sign-in is accepted", async () => {
  for (const safe of [fakeSafe(true, "basic_text"), fakeSafe(false)]) {
    const d = dir();
    const vault = keychainVault(safe, d, "linux");
    assert.equal(vault.available(), false);
    assert.throws(() => vault.saveToken(ACCT, FAKE_TOKEN));
    const service = createMixService({ source: new FakeMixSource(new Uint8Array(4)), vault, account: () => ACCT });
    assert.equal(await service.signIn({ username: "u", password: PASSWORD }), null);
    assert.deepEqual(readdirSync(d), []);
  }
});

test("a token longer than the cap is not kept", () => {
  const d = dir();
  assert.throws(() => keychainVault(fakeSafe(), d, "linux").saveToken(ACCT, "t".repeat(MAX_TOKEN_BYTES + 1)));
  assert.deepEqual(readdirSync(d), []);
});

test("key, token and folder are found per account and deleted; the other account's are left", () => {
  const d = dir();
  const v = keychainVault(fakeSafe(), d, "linux");
  v.saveToken(ACCT, FAKE_TOKEN);
  v.saveToken(OTHER, FAKE_TOKEN);
  writeFileSync(join(d, `mix-key-${ACCT}.bin`), "k");
  mkdirSync(join(d, "mixes", ACCT, "sub"), { recursive: true });
  writeFileSync(join(d, "mixes", ACCT, "sub", "m.enc"), "x");
  mkdirSync(join(d, "mixes", "not-an-account"), { recursive: true });
  assert.deepEqual(v.accounts(), [ACCT, OTHER]);
  assert.equal(v.hasKey(ACCT), true);
  v.clearKey(ACCT);
  assert.equal(v.hasKey(ACCT), false);
  v.clearToken(ACCT);
  assert.equal(v.loadToken(ACCT), null);
  v.removeFolder(ACCT);
  assert.equal(existsSync(join(d, "mixes", ACCT)), false);
  assert.deepEqual(v.accounts(), [OTHER]);
  assert.equal(existsSync(join(d, "mixes", "not-an-account")), true);
});

test("no path is built from anything but a 64-hex account key", () => {
  const v = keychainVault(fakeSafe(), dir(), "linux");
  for (const bad of ["", "..", `../${ACCT}`, ACCT.toUpperCase(), `${ACCT}0`, "a/b"]) {
    assert.throws(() => v.removeFolder(bad), bad);
    assert.throws(() => v.clearToken(bad), bad);
    assert.throws(() => v.clearKey(bad), bad);
    assert.throws(() => v.saveToken(bad, "t"), bad);
  }
});
