// Swedebeat sign-in and sign-out in the main process (main/mix/service.ts, ADR 0013 section 1),
// against the fake source and a fake vault: what was typed is used once and never kept, logged or
// answered back; the token goes only to the vault; ending an account deletes the key, then the
// token, then the folder; an invalid token deletes only the token.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { UnavailableMixSource } from "../../src/core/mix/unavailable-source.ts";
import { MIX_DISABLED } from "../../src/core/mix/view.ts";
import { createMixService } from "../../src/main/mix/service.ts";
import type { MixDeps } from "../../src/main/mix/service.ts";
import { MAX_TOKEN_BYTES } from "../../src/main/mix/vault.ts";
import { FAKE_TOKEN, FakeMixSource } from "./fake-mix-source.ts";
import { ACCT, fakeVault, OTHER } from "./mix-fakes.ts";

const PASSWORD = "SENTINEL-pw-7f3a9c";
const TYPED = { username: "ana.k", password: PASSWORD };

// Everything written to the console or the standard streams during a test.
let printed: string[] = [];
const saved: Record<string, unknown> = {};
beforeEach(() => {
  printed = [];
  for (const m of ["log", "info", "warn", "error", "debug", "trace"] as const) {
    saved[m] = console[m];
    console[m] = (...a: unknown[]) => void printed.push(a.map(String).join(" "));
  }
  for (const s of ["stdout", "stderr"] as const) {
    saved[s] = process[s].write;
    const orig = process[s].write.bind(process[s]);
    process[s].write = ((chunk: unknown, ...rest: unknown[]) => {
      printed.push(String(chunk));
      return (orig as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
  }
});
afterEach(() => {
  for (const m of ["log", "info", "warn", "error", "debug", "trace"] as const) console[m] = saved[m] as never;
  for (const s of ["stdout", "stderr"] as const) process[s].write = saved[s] as never;
});

function rig(over: Partial<MixDeps> = {}) {
  const source = new FakeMixSource(new Uint8Array(8));
  const vault = fakeVault();
  let account: string | null = ACCT;
  const service = createMixService({ source, vault, account: () => account, ...over });
  return { source, vault, service, setAccount: (a: string | null) => void (account = a) };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

test("sign-in: the details go to the source once, the token only to the vault, and nothing typed is kept, answered or printed", async () => {
  const r = rig();
  assert.equal(r.service.view().state, "signed_out");
  assert.deepEqual(r.service.view().fields.map((f) => [f.id, f.secret]), [["username", false], ["password", true]]);
  const v = await r.service.signIn(TYPED);
  assert.equal(v?.state, "signed_in");
  assert.deepEqual(r.source.calls, ["signIn password,username"]);
  assert.equal(r.vault.tokens.get(ACCT), FAKE_TOKEN);
  assert.deepEqual(r.vault.log, ["saveToken a"]);
  // Neither the password nor the token is in any answer or anything printed.
  const out = JSON.stringify([v, r.service.view()]) + printed.join("\n");
  assert.ok(!out.includes(PASSWORD));
  assert.ok(!out.includes(FAKE_TOKEN));
  // The only thing the vault ever got is the token.
  assert.ok(![...r.vault.tokens.values()].some((t) => t.includes(PASSWORD)));
  // A second sign-in while a token is held is refused and sends nothing.
  assert.equal(await r.service.signIn(TYPED), null);
  assert.equal(r.source.calls.length, 1);
});

test("a refused sign-in keeps nothing, shows the refusal, and the form may be offered again", async () => {
  for (const refusal of ["bad_credentials", "rate_limited", "unavailable"] as const) {
    const r = rig();
    r.source.refuseSignIn = refusal;
    const v = await r.service.signIn(TYPED);
    assert.equal(v?.state, "refused");
    assert.equal(v?.refusal, refusal);
    assert.equal(v?.fields.length, 2);
    assert.deepEqual(r.vault.log, []);
    assert.ok(!JSON.stringify(v).includes(PASSWORD) && !printed.join("").includes(PASSWORD));
  }
});

test("oversize, unexpected or missing input is refused before the source is called", async () => {
  const r = rig();
  for (const bad of [undefined, null, "x", { username: "u" }, { ...TYPED, extra: "x" }, { username: "u", password: "p".repeat(257) }, { username: "u", password: "" }]) {
    assert.equal(await r.service.signIn(bad), null);
  }
  assert.deepEqual(r.source.calls, []);
  assert.equal(r.service.view().state, "signed_out");
});

test("with the source off, no fields are shown and no sign-in is accepted", async () => {
  const vault = fakeVault();
  const service = createMixService({ source: new UnavailableMixSource(), vault, account: () => ACCT });
  assert.deepEqual(service.view(), MIX_DISABLED);
  assert.equal(await service.signIn(TYPED), null);
  assert.deepEqual(vault.log, []);
});

test("without a keychain or a pairing, no sign-in is offered or accepted", async () => {
  const r = rig();
  r.vault.usable = false;
  assert.equal(r.service.view().keychainUsable, false);
  assert.deepEqual(r.service.view().fields, []);
  assert.equal(await r.service.signIn(TYPED), null);
  const unpaired = rig();
  unpaired.setAccount(null);
  assert.deepEqual(unpaired.service.view().fields, []);
  assert.equal(await unpaired.service.signIn(TYPED), null);
  assert.deepEqual([...r.source.calls, ...unpaired.source.calls], []);
});

test("a sign-in that does not answer in time is 'could not be reached'; a token that comes late is not kept", async () => {
  const r = rig({ waitMs: 5 });
  let release: () => void = () => undefined;
  r.source.signIn = () => new Promise((res) => (release = () => res({ ok: true, token: "late-token" })));
  let signedOut = 0;
  r.source.signOut = async () => void signedOut++;
  const pending = r.service.signIn(TYPED);
  assert.equal(r.service.view().state, "signing_in");
  assert.equal(await r.service.signIn(TYPED), null, "one sign-in at a time");
  const v = await pending;
  assert.equal(v?.state, "refused");
  assert.equal(v?.refusal, "unavailable");
  release();
  await flush();
  await flush();
  assert.equal(r.vault.tokens.size, 0);
  assert.equal(signedOut, 1);
});

test("a token that cannot be kept, is too long, or arrives after the pairing changed is dropped", async () => {
  const unsaved = rig();
  unsaved.vault.failSave = true;
  assert.equal((await unsaved.service.signIn(TYPED))?.refusal, "unavailable");
  assert.equal(unsaved.vault.tokens.size, 0);

  const long = rig();
  long.source.signIn = async () => ({ ok: true, token: "t".repeat(MAX_TOKEN_BYTES + 1) });
  assert.equal((await long.service.signIn(TYPED))?.refusal, "unavailable");
  assert.equal(long.vault.tokens.size, 0);

  const moved = rig();
  moved.source.signIn = async () => (moved.setAccount(OTHER), { ok: true, token: FAKE_TOKEN });
  await moved.service.signIn(TYPED);
  assert.equal(moved.vault.tokens.size, 0);

  const thrown = rig();
  thrown.source.signIn = async () => {
    throw new Error(`boom ${PASSWORD}`);
  };
  assert.equal((await thrown.service.signIn(TYPED))?.refusal, "unavailable");
  assert.ok(!printed.join("").includes(PASSWORD));
});

test("sign-out deletes the key, then the token, then the folder, and tells the source last", async () => {
  const r = rig();
  await r.service.signIn(TYPED);
  r.vault.keys.add(ACCT);
  r.vault.folders.add(ACCT);
  r.vault.log.length = 0;
  const v = await r.service.signOut();
  assert.deepEqual(r.vault.log, ["clearKey a", "clearToken a", "removeFolder a"]);
  assert.equal(v?.state, "signed_out");
  assert.equal(v?.needsReconnect, false);
  await flush();
  assert.deepEqual(r.source.calls.slice(-1), ["signOut"]);
  assert.deepEqual(r.vault.accounts(), []);
});

test("sign-out removes the folder only once the account's downloads have stopped", async () => {
  let release: () => void = () => undefined;
  const asked: string[] = [];
  const r = rig({
    cancelDownloads: (a) => {
      asked.push(a);
      return new Promise<void>((done) => (release = done));
    },
  });
  await r.service.signIn(TYPED);
  r.vault.log.length = 0;
  const out = r.service.signOut();
  await flush();
  assert.deepEqual(asked, [ACCT]);
  assert.deepEqual(r.vault.log, ["clearKey a", "clearToken a"]);
  assert.equal(r.service.view().signingOut, true);
  assert.equal(await r.service.signOut(), null);
  release();
  assert.equal((await out)?.state, "signed_out");
  assert.deepEqual(r.vault.log, ["clearKey a", "clearToken a", "removeFolder a"]);
});

test("each deletion step runs even when the one before it fails", async () => {
  for (const step of ["clearKey", "clearToken", "removeFolder"]) {
    const r = rig();
    r.vault.tokens.set(ACCT, FAKE_TOKEN);
    r.vault.failStep = step;
    await r.service.signOut();
    assert.deepEqual(r.vault.log, ["clearKey a", "clearToken a", "removeFolder a"], step);
  }
});

test("an invalid token deletes the token only; the page says connect again and the mixes are kept", async () => {
  const r = rig();
  await r.service.signIn(TYPED);
  r.vault.keys.add(ACCT);
  r.vault.folders.add(ACCT);
  r.vault.log.length = 0;
  r.service.tokenInvalid(ACCT);
  assert.deepEqual(r.vault.log, ["clearToken a"]);
  assert.ok(r.vault.keys.has(ACCT) && r.vault.folders.has(ACCT));
  const v = r.service.view();
  assert.equal(v.state, "signed_out");
  assert.equal(v.needsReconnect, true);
  assert.equal(v.fields.length, 2);
  // Connecting again clears it.
  await r.service.signIn(TYPED);
  assert.equal(r.service.view().needsReconnect, false);
});

test("unpairing or deleting the account ends every account here, key then token then folder", async () => {
  const r = rig();
  await r.service.signIn(TYPED);
  r.vault.keys.add(ACCT);
  r.vault.folders.add(ACCT);
  r.vault.folders.add(OTHER);
  r.vault.log.length = 0;
  r.setAccount(null);
  await r.service.forgotten();
  // Every key and token goes first; each folder once that account's downloads have stopped.
  assert.deepEqual(r.vault.log, ["clearKey a", "clearToken a", "clearKey b", "clearToken b", "removeFolder a", "removeFolder b"]);
  assert.deepEqual(r.vault.accounts(), []);
});

test("at start, what other accounts left is deleted, and the folder of an account with no key", () => {
  const r = rig();
  r.vault.tokens.set(OTHER, "old");
  r.vault.tokens.set(ACCT, FAKE_TOKEN);
  r.vault.folders.add(ACCT);
  r.service.sweep();
  assert.deepEqual(r.vault.log, ["clearKey b", "clearToken b", "removeFolder b", "removeFolder a"]);
  assert.equal(r.vault.tokens.get(ACCT), FAKE_TOKEN);
  // Without a keychain nothing is touched: the pairing may still be there.
  const off = rig();
  off.vault.usable = false;
  off.vault.tokens.set(OTHER, "old");
  off.service.sweep();
  assert.deepEqual(off.vault.log, []);
});
