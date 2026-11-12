// registerHandlers with an untrusted sender, on every channel and on both command branches (music
// and clock): the sender check comes before any parsing, so a refused sender gets null, the
// controller is never touched and the message is not even looked at.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import { CH_COMMAND, CH_OPEN_DROPPED, CH_STATE } from "../../src/core/channels.ts";
import type { Controller } from "../../src/main/controller.ts";
import { registerHandlers } from "../../src/main/ipc-handlers.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";

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
  const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
  registerHandlers(bus, controller, () => TRUSTED);
  return { calls, snap, call: (ch: string, e: IpcMainInvokeEvent, raw?: unknown) => handlers.get(ch)!(e, raw), handlers };
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

test("all three channels are registered", () => {
  assert.deepEqual([...rig().handlers.keys()].sort(), [CH_COMMAND, CH_OPEN_DROPPED, CH_STATE].sort());
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
  test(`untrusted sender (${label}): state, music, clock and dropped file all get null, the controller is not touched, and nothing is parsed`, () => {
    const r = rig();
    assert.equal(r.call(CH_STATE, e), null);
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
