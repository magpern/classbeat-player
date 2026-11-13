// The room screen's window keeps the shell's hardening: its own sender check and channel set
// (core/ipc-policy.ts), a handler that answers only it and only with a RoomFrame, a preload that
// reads frames and sends only the room's fixed controls (room-controls.test.ts), and a page with its
// own policy. The presenter's pages never pass as the
// room, and the room never passes as one of them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { IpcMainInvokeEvent } from "electron";
import { CH_ROOM_COMMAND, CH_ROOM_END, CH_ROOM_REMOTE_START, CH_ROOM_REMOTE_STATE, CH_ROOM_REMOTE_STOP, CH_ROOM_REMOTE_UPDATE, CH_ROOM_STATE, CH_ROOM_UPDATE } from "../../src/core/channels.ts";
import { isRoomSender, pageOf, ROOM_CHANNELS, ROOM_PUSH_CHANNELS } from "../../src/core/ipc-policy.ts";
import { NO_REMOTE } from "../../src/core/room/remote.ts";
import { roomFrameOf } from "../../src/core/room/frame.ts";
import type { Snapshot } from "../../src/core/snapshot.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import { registerRoomHandlers } from "../../src/main/room/room-handlers.ts";
import { LIST_CSP, ROOM_CSP } from "../../src/main/web-preferences.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p: string[]): string => readFileSync(join(APP, ...p), "utf8");
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ROOM = { roomId: 9, roomUrl: "file:///app/dist/room.html" };
const MAIN = { presenterId: 7, presenterUrl: "file:///app/dist/presenter.html", listUrl: "file:///app/dist/classlist.html" };
const GOOD = { senderId: 9, topFrame: true, frameUrl: ROOM.roomUrl };

test("sender: the room window's top frame on the room page, and nothing else", () => {
  assert.equal(isRoomSender(GOOD, ROOM), true);
  assert.equal(isRoomSender({ ...GOOD, frameUrl: `${ROOM.roomUrl}?x#y` }, ROOM), true);
  for (const [label, facts, trusted] of [
    ["the main window", { ...GOOD, senderId: 7 }, ROOM],
    ["a subframe", { ...GOOD, topFrame: false }, ROOM],
    ["the presenter page in the room window", { ...GOOD, frameUrl: MAIN.presenterUrl }, ROOM],
    ["the class list in the room window", { ...GOOD, frameUrl: MAIN.listUrl }, ROOM],
    ["another file", { ...GOOD, frameUrl: "file:///app/dist/room.html.evil" }, ROOM],
    ["a web page", { ...GOOD, frameUrl: "https://example.invalid/room.html" }, ROOM],
    ["no room window", GOOD, { ...ROOM, roomId: null }],
  ] as const) {
    assert.equal(isRoomSender(facts, trusted), false, label);
  }
});

test("the room never passes as the presenter or the class list, even on their pages", () => {
  for (const url of [ROOM.roomUrl, MAIN.presenterUrl, MAIN.listUrl]) assert.equal(pageOf({ ...GOOD, frameUrl: url }, MAIN), null, url);
  // And the main window on the room page is neither the room nor one of its own pages.
  assert.equal(isRoomSender({ senderId: 7, topFrame: true, frameUrl: ROOM.roomUrl }, ROOM), false);
  assert.equal(pageOf({ senderId: 7, topFrame: true, frameUrl: ROOM.roomUrl }, MAIN), null);
});

const SNAP = {
  loadId: 1,
  fileName: "secret-name.json",
  doc: { marker: "doc" },
  view: { marker: "view" },
  link: { marker: "link" },
  controls: { marker: "controls" },
  error: { message: "m", details: [] },
} as unknown as Snapshot;

test("a frame carries the class, the clock view and the link view, and nothing else of the snapshot", () => {
  assert.deepEqual(Object.keys(roomFrameOf(SNAP)).sort(), ["doc", "link", "view"]);
  assert.deepEqual(roomFrameOf(SNAP), { doc: SNAP.doc, view: SNAP.view, link: SNAP.link });
});

function rig() {
  const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
  let reads = 0;
  const fail = (): never => assert.fail("a refused message reached the shell");
  registerRoomHandlers(bus, () => ROOM, { snapshot: () => (reads++, SNAP), command: fail }, { endClass: fail, remote: NO_REMOTE, log: () => undefined });
  const ev = (id: number, url: string, parent: unknown = null, noFrame = false): IpcMainInvokeEvent =>
    ({ sender: { id }, senderFrame: noFrame ? null : { parent, url } }) as unknown as IpcMainInvokeEvent;
  return { handlers, ev, reads: () => reads };
}

test("the handler registers the room's channels only, and answers the room with a frame", () => {
  const r = rig();
  assert.deepEqual([...r.handlers.keys()], [...ROOM_CHANNELS]);
  assert.deepEqual(r.handlers.get(CH_ROOM_STATE)!(r.ev(9, ROOM.roomUrl), { anything: 1 }), roomFrameOf(SNAP));
});

test("every room handler refuses every other sender without reading the clock or acting", () => {
  const r = rig();
  for (const ch of ROOM_CHANNELS) {
    const h = r.handlers.get(ch)!;
    for (const e of [r.ev(7, ROOM.roomUrl), r.ev(7, MAIN.presenterUrl), r.ev(9, MAIN.presenterUrl), r.ev(9, ROOM.roomUrl, {}), r.ev(9, ROOM.roomUrl, null, true)]) {
      assert.equal(h(e, ch === CH_ROOM_COMMAND ? { type: "start" } : undefined), null, ch);
    }
  }
  assert.equal(r.reads(), 0);
});

test("the room preload exposes exactly the room's functions, and uses only the room's channels", () => {
  const src = code(read("src", "preload", "room-preload.ts"));
  assert.deepEqual(
    [...src.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort(),
    ["back", "endClass", "follow", "forward", "next", "onRemote", "onUpdate", "pause", "previous", "remoteState", "resume", "start", "startRemote", "state", "stopRemote", "undo"],
  );
  const invoked = [...src.matchAll(/ipcRenderer\.invoke\((\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(invoked)].sort(), ["CH_ROOM_COMMAND", "CH_ROOM_END", "CH_ROOM_REMOTE_START", "CH_ROOM_REMOTE_STATE", "CH_ROOM_REMOTE_STOP", "CH_ROOM_STATE"]);
  assert.deepEqual([...src.matchAll(/ipcRenderer\.on\((\w+)/g)].map((m) => m[1]), ["CH_ROOM_UPDATE", "CH_ROOM_REMOTE_UPDATE"]);
  assert.doesNotMatch(src, /ipcRenderer\.(send|sendSync|postMessage|addListener|once)\b/);
  assert.deepEqual(ROOM_CHANNELS, [CH_ROOM_STATE, CH_ROOM_COMMAND, CH_ROOM_END, CH_ROOM_REMOTE_STATE, CH_ROOM_REMOTE_START, CH_ROOM_REMOTE_STOP]);
  assert.deepEqual(ROOM_PUSH_CHANNELS, [CH_ROOM_UPDATE, CH_ROOM_REMOTE_UPDATE]);
  // The presenter's preload knows nothing of the room.
  assert.doesNotMatch(code(read("src", "preload", "preload.ts")), /CH_ROOM_|room:/);
  assert.equal(new Set([...ROOM_CHANNELS, ...ROOM_PUSH_CHANNELS]).size, ROOM_CHANNELS.length + ROOM_PUSH_CHANNELS.length);
});

test("room.html carries exactly the room's policy, before any script, and no inline script, style or handler", () => {
  const html = read("src", "renderer", "room.html");
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(m, "CSP meta tag missing");
  assert.equal(m[1], ROOM_CSP);
  assert.equal(ROOM_CSP, LIST_CSP);
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"));
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)|<style|\sstyle=|\son[a-z]+=/i);
  assert.doesNotMatch(ROOM_CSP, /unsafe-inline|unsafe-eval|https?:|data:|blob:|\*/);
  for (const k of ["connect-src", "media-src", "object-src", "frame-src", "worker-src", "img-src"]) assert.match(ROOM_CSP, new RegExp(`${k} 'none'`), k);
});

test("the room page sends nothing: it only reads its state and its pushes", () => {
  const src = code(read("src", "renderer", "room.ts"));
  assert.deepEqual([...src.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]).sort(), ["onUpdate", "state"]);
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|player\./);
});
