// The class list's IPC (main/list/list-handlers.ts, core/list/commands.ts): only the list page
// may use its channels, and the presenter page only its own; Start takes exactly an id and a
// hash; a refused start opens nothing; Back works only while a class is pinned.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import { CH_COMMAND, CH_OPEN_DROPPED, CH_LIST_BACK, CH_LIST_DISMISS, CH_LIST_OPEN_FILE, CH_LIST_START, CH_LIST_VIEW, CH_STATE } from "../../src/core/channels.ts";
import { parseStartRequest } from "../../src/core/list/commands.ts";
import type { PairingService } from "../../src/main/pairing/service.ts";
import { registerHandlers } from "../../src/main/ipc-handlers.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import { registerListHandlers } from "../../src/main/list/list-handlers.ts";
import type { ListController } from "../../src/main/list/list-controller.ts";
import type { Controller } from "../../src/main/controller.ts";
import { view } from "./list-fixtures.ts";
import { ID_A } from "./sync-fixtures.ts";

const TRUSTED = { presenterId: 7, presenterUrl: "file:///app/dist/presenter.html", listUrl: "file:///app/dist/classlist.html" };
const event = (url: string, over: { id?: number; parent?: unknown } = {}): IpcMainInvokeEvent => ({ sender: { id: over.id ?? 7 }, senderFrame: { parent: over.parent ?? null, url } }) as unknown as IpcMainInvokeEvent;
const fromList = event(TRUSTED.listUrl);
const HASH = `sha256:${"1".repeat(64)}`;

function rig(startResult = true, pinned = false) {
  const calls: string[] = [];
  const v = view({ sync: { pinned: pinned ? { id: ID_A, after: "none" } : null } });
  const list: ListController = {
    view: () => v,
    start: (id, hash) => (calls.push(`start ${id} ${hash}`), startResult),
    fileFailed: () => void calls.push("failed"),
    dismissFileError: () => void calls.push("dismiss"),
    release: () => void calls.push("release"),
  };
  const host = { showPresenter: () => void calls.push("showPresenter"), openFile: async () => void calls.push("openFile") };
  const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
  registerListHandlers(bus, () => TRUSTED, list, host);
  const controller = { snapshot: () => (calls.push("snapshot"), {}), command: () => (calls.push("command"), {}), open: () => (calls.push("open"), {}) } as unknown as Controller;
  registerHandlers(bus, controller, () => TRUSTED, {} as PairingService);
  return { calls, v, call: (ch: string, e: IpcMainInvokeEvent, raw?: unknown) => handlers.get(ch)!(e, raw) };
}

test("a start takes exactly a class id and a hash", () => {
  assert.deepEqual(parseStartRequest({ id: ID_A, hash: HASH }), { id: ID_A, hash: HASH });
  const bad: unknown[] = [null, "x", [], { id: ID_A }, { hash: HASH }, { id: ID_A, hash: HASH, path: "/etc" }, { id: "../x", hash: HASH }, { id: ID_A, hash: "" }, { id: ID_A, hash: "x".repeat(101) }, { id: ID_A, hash: 5 }, Object.create({ id: ID_A, hash: HASH })];
  for (const b of bad) assert.equal(parseStartRequest(b), null, JSON.stringify(b));
});

test("Start from the list page pins and shows the presenter; a refused start shows nothing new and answers the list as it is", () => {
  const ok = rig(true);
  assert.equal(ok.call(CH_LIST_START, fromList, { id: ID_A, hash: HASH }), ok.v);
  assert.deepEqual(ok.calls, [`start ${ID_A} ${HASH}`, "showPresenter"]);
  const refused = rig(false);
  assert.equal(refused.call(CH_LIST_START, fromList, { id: ID_A, hash: HASH }), refused.v);
  assert.deepEqual(refused.calls, [`start ${ID_A} ${HASH}`]);
  const malformed = rig(true);
  malformed.call(CH_LIST_START, fromList, { id: ID_A });
  assert.deepEqual(malformed.calls, []);
});

test("every list channel refuses the presenter page, a subframe, another window and a missing frame", async () => {
  const r = rig(true, true);
  const wrong: IpcMainInvokeEvent[] = [event(TRUSTED.presenterUrl), event(TRUSTED.listUrl, { parent: {} }), event(TRUSTED.listUrl, { id: 8 }), event("file:///etc/hostname"), { sender: { id: 7 }, senderFrame: null } as unknown as IpcMainInvokeEvent];
  for (const ch of [CH_LIST_VIEW, CH_LIST_START, CH_LIST_OPEN_FILE, CH_LIST_DISMISS, CH_LIST_BACK]) {
    for (const e of wrong) assert.equal(await r.call(ch, e, { id: ID_A, hash: HASH }), null, ch);
  }
  assert.deepEqual(r.calls, []);
});

test("the clock's channels refuse the list page", () => {
  const r = rig();
  for (const ch of [CH_STATE, CH_COMMAND]) assert.equal(r.call(ch, fromList, { type: "start" }), null, ch);
  // A class file dropped is the presenter's: from the list page it is refused and never opened.
  assert.equal(r.call(CH_OPEN_DROPPED, fromList, { name: "a.json", text: "{}" }), null);
  assert.deepEqual(r.calls, []);
  assert.notEqual(r.call(CH_STATE, event(TRUSTED.presenterUrl)), null);
});

test("Back to the class shows the presenter only while a class is pinned; Open and Close reach the shell", async () => {
  const idle = rig(true, false);
  idle.call(CH_LIST_BACK, fromList);
  assert.deepEqual(idle.calls, []);
  const playing = rig(true, true);
  playing.call(CH_LIST_BACK, fromList);
  assert.deepEqual(playing.calls, ["showPresenter"]);
  const r = rig();
  await r.call(CH_LIST_OPEN_FILE, fromList);
  r.call(CH_LIST_DISMISS, fromList);
  assert.deepEqual(r.calls, ["openFile", "dismiss"]);
});
