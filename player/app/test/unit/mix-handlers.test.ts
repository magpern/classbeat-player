// The Swedebeat sign-in channels (main/mix/mix-handlers.ts, core/ipc-policy.ts): the class list
// page's only, checked before anything is read; oversize and unexpected input is refused and
// reaches no source; the answer is the list, never a token or anything typed.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import { CH_MIX_SIGN_IN, CH_MIX_SIGN_OUT } from "../../src/core/channels.ts";
import { MIX_CHANNELS, ROOM_CHANNELS, ROOM_PUSH_CHANNELS } from "../../src/core/ipc-policy.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import { registerMixHandlers } from "../../src/main/mix/mix-handlers.ts";
import { createMixService } from "../../src/main/mix/service.ts";
import { FAKE_TOKEN, FakeMixSource } from "./fake-mix-source.ts";
import { view } from "./list-fixtures.ts";
import { ACCT, fakeVault } from "./mix-fakes.ts";

const PASSWORD = "SENTINEL-pw-7f3a9c";
const TRUSTED = { presenterId: 7, presenterUrl: "file:///app/dist/presenter.html", listUrl: "file:///app/dist/classlist.html" };
const event = (url: string, over: { id?: number; parent?: unknown } = {}): IpcMainInvokeEvent => ({ sender: { id: over.id ?? 7 }, senderFrame: { parent: over.parent ?? null, url } }) as unknown as IpcMainInvokeEvent;
const fromList = event(TRUSTED.listUrl);

function rig() {
  const source = new FakeMixSource(new Uint8Array(4));
  const vault = fakeVault();
  const mix = createMixService({ source, vault, account: () => ACCT });
  const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
  const signedIn = { n: 0 };
  registerMixHandlers(bus, () => TRUSTED, mix, { view: () => ({ ...view(), mix: mix.view() }) }, () => void signedIn.n++);
  return { signedIn, source, vault, mix, handlers, call: (ch: string, e: IpcMainInvokeEvent, raw?: unknown) => handlers.get(ch)!(e, raw) };
}

test("the sign-in channels are the list page's only: never the room's, and named as the issue says", () => {
  assert.deepEqual(MIX_CHANNELS, ["player:mix-sign-in", "player:mix-sign-out"]);
  for (const ch of MIX_CHANNELS) assert.ok(!ROOM_CHANNELS.includes(ch) && !ROOM_PUSH_CHANNELS.includes(ch), ch);
  assert.deepEqual([...rig().handlers.keys()], [CH_MIX_SIGN_IN, CH_MIX_SIGN_OUT]);
});

test("every sender but the list page's top frame is refused before anything is read", async () => {
  const r = rig();
  let read = 0;
  const watched = new Proxy({ username: "u", password: PASSWORD }, { get: (t, k) => (read++, Reflect.get(t, k)), ownKeys: (t) => (read++, Reflect.ownKeys(t)) });
  const wrong: IpcMainInvokeEvent[] = [event(TRUSTED.presenterUrl), event(TRUSTED.listUrl, { parent: {} }), event(TRUSTED.listUrl, { id: 8 }), event("file:///etc/hostname"), event(`${TRUSTED.listUrl}x`), { sender: { id: 7 }, senderFrame: null } as unknown as IpcMainInvokeEvent];
  for (const e of wrong) {
    assert.equal(await r.call(CH_MIX_SIGN_IN, e, watched), null);
    assert.equal(await r.call(CH_MIX_SIGN_OUT, e), null);
  }
  assert.equal(read, 0);
  assert.equal(r.signedIn.n, 0, "no download check for a refused sender");
  assert.deepEqual(r.source.calls, []);
  assert.deepEqual(r.vault.log, []);
});

test("oversize and unexpected input is refused and reaches no source", async () => {
  const r = rig();
  const bad: unknown[] = [undefined, null, "u:p", [], {}, { username: "u" }, { username: "u", password: "p", origin: "http://127.0.0.1" }, { username: "u".repeat(257), password: "p" }, { username: "u", password: "p".repeat(1_000_000) }];
  for (const b of bad) assert.equal(await r.call(CH_MIX_SIGN_IN, fromList, b), null);
  assert.equal(r.signedIn.n, 0);
  assert.deepEqual(r.source.calls, []);
  // Sign-out takes nothing.
  assert.equal(await r.call(CH_MIX_SIGN_OUT, fromList, { all: true }), null);
  assert.deepEqual(r.vault.log, []);
});

test("from the list page: sign in, then sign out; no answer carries the token or the password", async () => {
  const r = rig();
  const signedIn = await r.call(CH_MIX_SIGN_IN, fromList, { username: "ana.k", password: PASSWORD });
  assert.equal((signedIn as ReturnType<typeof view>).mix.state, "signed_in");
  assert.equal(r.signedIn.n, 1, "the synced classes' mixes are checked for download after the sign-in");
  const signedOut = await r.call(CH_MIX_SIGN_OUT, fromList);
  assert.equal((signedOut as ReturnType<typeof view>).mix.state, "signed_out");
  assert.equal(r.signedIn.n, 2, "the sign-out is checked too, so the next sign-in asks every mix again (#720)");
  const out = JSON.stringify([signedIn, signedOut]);
  assert.ok(!out.includes(PASSWORD) && !out.includes(FAKE_TOKEN));
  assert.deepEqual(r.vault.log, ["saveToken a", "markEnding a", "clearKey a", "clearToken a", "removeFolder a", "clearEnding a"]);
});
