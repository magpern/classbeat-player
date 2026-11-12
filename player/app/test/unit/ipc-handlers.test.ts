// registerHandlers with an untrusted sender, on every channel and on both command branches (music
// and clock): the sender check comes before any parsing, so a refused sender gets null, the
// controller is never touched and the message is not even looked at.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import { CH_COMMAND, CH_OPEN_DROPPED, CH_PAIRING_START, CH_PAIRING_STATE, CH_STATE, CH_UNPAIR } from "../../src/core/channels.ts";
import type { Controller } from "../../src/main/controller.ts";
import { registerHandlers } from "../../src/main/ipc-handlers.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import type { PairingService } from "../../src/main/pairing/service.ts";

const TRUSTED = { presenterId: 7, presenterUrl: "file:///app/dist/presenter.html" };
const event = (over: { id?: number; parent?: unknown; url?: string; noFrame?: boolean } = {}): IpcMainInvokeEvent =>
  ({
    sender: { id: over.id ?? 7 },
    senderFrame: over.noFrame ? null : { parent: over.parent ?? null, url: over.url ?? TRUSTED.presenterUrl },
  }) as unknown as IpcMainInvokeEvent;

function rig() {
  const calls: string[] = [];
  const snap = { marker: "snapshot" };
  const controller = {
    snapshot: () => (calls.push("snapshot"), snap),
    open: () => (calls.push("open"), snap),
    command: () => (calls.push("command"), snap),
    music: () => (calls.push("music"), snap),
  } as unknown as Controller;
  const view = { state: "unpaired", message: null };
  const pairing = {
    view: () => (calls.push("pairing.view"), view),
    start: () => (calls.push("pairing.start"), view),
    unpair: () => (calls.push("pairing.unpair"), view),
  } as unknown as PairingService;
  const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
  registerHandlers(bus, controller, () => TRUSTED, pairing);
  return { calls, snap, view, call: (ch: string, e: IpcMainInvokeEvent, raw?: unknown) => handlers.get(ch)!(e, raw), handlers };
}

/** A message that the parser would accept, and a getter that records every read of it. */
function watched(valid: object): { raw: object; reads: () => number } {
  let reads = 0;
  const raw = new Proxy(valid, {
    get(t, k, r) {
      reads += 1;
      return Reflect.get(t, k, r);
    },
    ownKeys(t) {
      reads += 1;
      return Reflect.ownKeys(t);
    },
    getPrototypeOf(t) {
      reads += 1;
      return Reflect.getPrototypeOf(t);
    },
  });
  return { raw, reads: () => reads };
}

const UNTRUSTED = [
  ["another window", event({ id: 8 })],
  ["a subframe", event({ parent: {} })],
  ["another page", event({ url: "file:///app/dist/other.html" })],
  ["a remote page", event({ url: "https://example.invalid/presenter.html" })],
  ["no frame", event({ noFrame: true })],
] as const;

test("the six channels are registered, and no other", () => {
  assert.deepEqual([...rig().handlers.keys()].sort(), [CH_COMMAND, CH_OPEN_DROPPED, CH_PAIRING_START, CH_PAIRING_STATE, CH_STATE, CH_UNPAIR].sort());
});

test("pairing: a trusted sender is served, and whatever the page sends along is never read", () => {
  const r = rig();
  for (const ch of [CH_PAIRING_STATE, CH_PAIRING_START, CH_UNPAIR]) {
    const w = watched({ deviceCode: "x", origin: "https://example.invalid" });
    assert.equal(r.call(ch, event(), w.raw), r.view, ch);
    assert.equal(w.reads(), 0, `${ch} read its argument`);
  }
  assert.deepEqual(r.calls, ["pairing.view", "pairing.start", "pairing.unpair"]);
});

test("a trusted sender is served on every branch", () => {
  const r = rig();
  assert.equal(r.call(CH_STATE, event()), r.snap);
  assert.equal(r.call(CH_COMMAND, event(), { type: "music", action: "next" }), r.snap);
  assert.equal(r.call(CH_COMMAND, event(), { type: "pause" }), r.snap);
  assert.equal(r.call(CH_OPEN_DROPPED, event(), { name: "a.json", text: "{}" }), r.snap);
  assert.deepEqual(r.calls, ["snapshot", "music", "command", "open"]);
});

for (const [label, e] of UNTRUSTED) {
  test(`untrusted sender (${label}): state, music, clock, dropped file and pairing all get null, the controller and pairing are not touched, and nothing is parsed`, () => {
    const r = rig();
    assert.equal(r.call(CH_STATE, e), null);
    for (const ch of [CH_PAIRING_STATE, CH_PAIRING_START, CH_UNPAIR]) assert.equal(r.call(ch, e), null, ch);
    const cases: [string, object][] = [
      [CH_COMMAND, { type: "music", action: "next" }],
      [CH_COMMAND, { type: "pause" }],
      [CH_COMMAND, { type: "jump", deltaMs: 5000 }],
      [CH_OPEN_DROPPED, { name: "a.json", text: "{}" }],
    ];
    for (const [ch, valid] of cases) {
      const w = watched(valid);
      assert.equal(r.call(ch, e, w.raw), null, `${ch} ${JSON.stringify(valid)}`);
      assert.equal(w.reads(), 0, `the message was read before the sender was checked: ${ch}`);
    }
    assert.deepEqual(r.calls, []);
  });
}

test("a trusted sender with a refused shape also gets null, and the controller is not touched", () => {
  const r = rig();
  for (const bad of [{ type: "music", action: "format" }, { type: "pause", extra: 1 }, null, "pause"]) assert.equal(r.call(CH_COMMAND, event(), bad), null);
  assert.equal(r.call(CH_OPEN_DROPPED, event(), { name: 1 }), null);
  assert.deepEqual(r.calls, []);
});
