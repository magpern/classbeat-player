// The update bridge (main/update/update-handlers.ts, ADR 0014 section 5): five channels, the class
// list page's only, the sender checked before anything is read. The calls without an argument refuse
// any argument; the switches take exactly true or false. No channel takes an address, a path or the
// feed, and Open release page answers nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import { CH_UPDATE_CHECK, CH_UPDATE_OPEN_RELEASE, CH_UPDATE_SET_AUTO, CH_UPDATE_SET_PRERELEASES, CH_UPDATE_STATUS } from "../../src/core/channels.ts";
import { ROOM_CHANNELS, ROOM_PUSH_CHANNELS, UPDATE_CHANNELS } from "../../src/core/ipc-policy.ts";
import type { UpdateView } from "../../src/core/update/view.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import type { UpdateService } from "../../src/main/update/service.ts";
import { registerUpdateHandlers } from "../../src/main/update/update-handlers.ts";

const TRUSTED = { presenterId: 7, presenterUrl: "file:///app/dist/presenter.html", listUrl: "file:///app/dist/classlist.html" };
const event = (url: string, over: { id?: number; parent?: unknown } = {}): IpcMainInvokeEvent => ({ sender: { id: over.id ?? 7 }, senderFrame: { parent: over.parent ?? null, url } }) as unknown as IpcMainInvokeEvent;
const fromList = event(TRUSTED.listUrl);
const VIEW: UpdateView = { kind: "up to date", current: "0.1.0", latest: "0.1.0", notice: null, auto: true, prereleases: false };

function rig() {
  const asked: unknown[][] = [];
  const updates: UpdateService = {
    start: () => assert.fail("start is the shell's"),
    view: () => (asked.push(["view"]), VIEW),
    checkNow: () => (asked.push(["check"]), VIEW),
    openReleasePage: () => (asked.push(["open"]), true),
    setAutomaticChecks: (on) => (asked.push(["auto", on]), VIEW),
    setPrereleases: (on) => (asked.push(["pre", on]), VIEW),
    stop: () => assert.fail("stop is the shell's"),
    idle: () => Promise.resolve(),
  };
  const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
  registerUpdateHandlers(bus, () => TRUSTED, updates);
  return { asked, handlers, call: (ch: string, e: IpcMainInvokeEvent, ...raw: unknown[]) => handlers.get(ch)!(e, raw[0]) };
}

test("exactly the five update channels, none of them the room's", () => {
  assert.deepEqual(UPDATE_CHANNELS, ["update:status", "update:check", "update:open-release", "update:set-auto", "update:set-prereleases"]);
  for (const ch of UPDATE_CHANNELS) assert.ok(!ROOM_CHANNELS.includes(ch) && !ROOM_PUSH_CHANNELS.includes(ch), ch);
  assert.deepEqual([...rig().handlers.keys()], [CH_UPDATE_STATUS, CH_UPDATE_CHECK, CH_UPDATE_OPEN_RELEASE, CH_UPDATE_SET_AUTO, CH_UPDATE_SET_PRERELEASES]);
});

test("the list page gets the status, Check now, Open release page and the two switches", () => {
  const r = rig();
  assert.equal(r.call(CH_UPDATE_STATUS, fromList), VIEW);
  assert.equal(r.call(CH_UPDATE_CHECK, fromList), VIEW);
  assert.equal(r.call(CH_UPDATE_OPEN_RELEASE, fromList), null, "answers nothing");
  assert.equal(r.call(CH_UPDATE_SET_AUTO, fromList, false), VIEW);
  assert.equal(r.call(CH_UPDATE_SET_PRERELEASES, fromList, true), VIEW);
  assert.deepEqual(r.asked, [["view"], ["check"], ["open"], ["auto", false], ["pre", true]]);
});

test("every sender but the list page's top frame is refused before anything is read", () => {
  const r = rig();
  const wrong: IpcMainInvokeEvent[] = [event(TRUSTED.presenterUrl), event(TRUSTED.listUrl, { parent: {} }), event(TRUSTED.listUrl, { id: 8 }), event("file:///etc/hostname"), event(`${TRUSTED.listUrl}x`), { sender: { id: 7 }, senderFrame: null } as unknown as IpcMainInvokeEvent];
  let read = 0;
  const watched = new Proxy({}, { get: (t, k) => (read++, Reflect.get(t, k)) });
  for (const e of wrong) {
    for (const ch of UPDATE_CHANNELS) assert.equal(r.call(ch, e, ch.includes("set-") ? true : undefined), null, ch);
    assert.equal(r.call(CH_UPDATE_SET_AUTO, e, watched), null);
  }
  assert.equal(read, 0);
  assert.deepEqual(r.asked, []);
});

test("an address, a path, the feed or any other argument reaches nothing; the switches take only true or false", () => {
  const r = rig();
  const args: unknown[] = ["https://evil.invalid/", "/etc/passwd", { feed: "https://evil.invalid/" }, ["0.2.0"], "0.2.0", 1, 0, "true", null, {}];
  for (const a of args) {
    assert.equal(r.call(CH_UPDATE_STATUS, fromList, a), null);
    assert.equal(r.call(CH_UPDATE_CHECK, fromList, a), null);
    assert.equal(r.call(CH_UPDATE_OPEN_RELEASE, fromList, a), null);
    assert.equal(r.call(CH_UPDATE_SET_AUTO, fromList, a), null);
    assert.equal(r.call(CH_UPDATE_SET_PRERELEASES, fromList, a), null);
  }
  assert.equal(r.call(CH_UPDATE_SET_AUTO, fromList), null, "no argument is not a boolean");
  assert.deepEqual(r.asked, []);
});
