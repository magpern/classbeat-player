// The local music files channels (main/music-files/handlers.ts, core/ipc-policy.ts; #920): the
// instructor's class list page only, never the room window, the presenter or any other sender,
// checked before anything is read; only a class id is taken; a fault answers the fixed `failed`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import { CH_MUSIC_FILES_FIND, CH_MUSIC_FILES_FIND_CANCEL } from "../../src/core/channels.ts";
import { MIX_CHANNELS, MUSIC_FILES_CHANNELS, MUSIC_FILES_PAGE, ROOM_CHANNELS, ROOM_PUSH_CHANNELS, UPDATE_CHANNELS } from "../../src/core/ipc-policy.ts";
import type { FindAnswer } from "../../src/core/music-files/answer.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import { registerMusicFilesHandlers } from "../../src/main/music-files/handlers.ts";

const ID = "6f1c2b8e-3d4a-4b5c-9e7f-0a1b2c3d4e5f";
const TRUSTED = { presenterId: 7, presenterUrl: "file:///app/dist/presenter.html", listUrl: "file:///app/dist/classlist.html" };
const event = (url: string, over: { id?: number; parent?: unknown } = {}): IpcMainInvokeEvent => ({ sender: { id: over.id ?? 7 }, senderFrame: { parent: over.parent ?? null, url } }) as unknown as IpcMainInvokeEvent;
const fromList = event(TRUSTED.listUrl);
const DONE: FindAnswer = { status: "done", songs: ["found", "missing"], limit_reached: false };

function rig(find: (id: string) => Promise<FindAnswer | null> = async () => DONE) {
  const calls: string[] = [];
  const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
  registerMusicFilesHandlers(bus, () => TRUSTED, {
    find: (id) => (calls.push(`find ${id}`), find(id)),
    cancel: () => (calls.push("cancel"), true),
  });
  return { calls, handlers, call: (ch: string, e: IpcMainInvokeEvent, raw?: unknown) => handlers.get(ch)!(e, raw) };
}

test("the channels are the list page's only, named as the issue says, and none is the room's", () => {
  assert.deepEqual(MUSIC_FILES_CHANNELS, ["player:music-files-find", "player:music-files-find-cancel"]);
  assert.equal(MUSIC_FILES_PAGE, "list");
  for (const ch of MUSIC_FILES_CHANNELS) {
    assert.ok(!ROOM_CHANNELS.includes(ch) && !ROOM_PUSH_CHANNELS.includes(ch), ch);
    assert.ok(!MIX_CHANNELS.includes(ch) && !UPDATE_CHANNELS.includes(ch), ch);
  }
  assert.deepEqual([...rig().handlers.keys()], [CH_MUSIC_FILES_FIND, CH_MUSIC_FILES_FIND_CANCEL]);
});

test("the room window, the presenter, a subframe and every other sender are refused before anything is read", async () => {
  const r = rig();
  let read = 0;
  const watched = new Proxy(new String(ID), { get: (t, k) => (read++, Reflect.get(t, k)), ownKeys: (t) => (read++, Reflect.ownKeys(t)) });
  const wrong: IpcMainInvokeEvent[] = [
    event("file:///app/dist/room.html", { id: 9 }),
    event(TRUSTED.listUrl, { id: 9 }),
    event(TRUSTED.presenterUrl),
    event(TRUSTED.listUrl, { parent: {} }),
    event(TRUSTED.listUrl, { id: 8 }),
    event("file:///etc/hostname"),
    event(`${TRUSTED.listUrl}x`),
    event("https://example.invalid/classlist.html"),
    { sender: { id: 7 }, senderFrame: null } as unknown as IpcMainInvokeEvent,
  ];
  for (const e of wrong) {
    assert.equal(await r.call(CH_MUSIC_FILES_FIND, e, watched), null);
    assert.equal(await r.call(CH_MUSIC_FILES_FIND, e, ID), null);
    assert.equal(await r.call(CH_MUSIC_FILES_FIND_CANCEL, e), null);
  }
  assert.equal(read, 0);
  assert.deepEqual(r.calls, []);
});

test("find takes a class id only, cancel takes nothing; anything else is refused and reaches nothing", async () => {
  const r = rig();
  const bad: unknown[] = [undefined, null, "", "/home/a/Music", "C:\\Music", ID.toUpperCase(), `${ID} `, [ID], { id: ID }, { id: ID, folder: "/tmp" }, 1, true];
  for (const b of bad) assert.equal(await r.call(CH_MUSIC_FILES_FIND, fromList, b), null);
  for (const b of [null, "", ID, {}, [], 0, false]) assert.equal(await r.call(CH_MUSIC_FILES_FIND_CANCEL, fromList, b), null);
  assert.deepEqual(r.calls, []);
});

test("from the list page: the find's answer passes through, and cancel answers a boolean", async () => {
  const r = rig();
  assert.deepEqual(await r.call(CH_MUSIC_FILES_FIND, fromList, ID), DONE);
  assert.equal(await r.call(CH_MUSIC_FILES_FIND_CANCEL, fromList), true);
  assert.deepEqual(r.calls, [`find ${ID}`, "cancel"]);
});

test("a find that throws answers the fixed `failed`: the error's text, which could name the disk, never reaches the page", async () => {
  const secret = "/home/ana/Music/SENTINEL-folder";
  const r = rig(async () => {
    throw new Error(`ENOENT: ${secret}`);
  });
  const answer = await r.call(CH_MUSIC_FILES_FIND, fromList, ID);
  assert.deepEqual(answer, { status: "failed" });
  assert.ok(!JSON.stringify(answer).includes("SENTINEL"));
});
