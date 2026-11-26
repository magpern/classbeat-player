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
import { CH_ROOM_COMMAND, CH_ROOM_END, CH_ROOM_MIX, CH_ROOM_MIX_REPORT, CH_ROOM_REMOTE_START, CH_ROOM_REMOTE_STATE, CH_ROOM_REMOTE_STOP, CH_ROOM_REMOTE_UPDATE, CH_ROOM_STATE, CH_ROOM_UPDATE } from "../../src/core/channels.ts";
import { isRoomSender, pageOf, ROOM_CHANNELS, ROOM_PUSH_CHANNELS } from "../../src/core/ipc-policy.ts";
import { NO_REMOTE } from "../../src/core/room/remote.ts";
import { roomFrameOf } from "../../src/core/room/frame.ts";
import type { MixLine } from "../../src/core/mix/mix-line.ts";
import type { Snapshot } from "../../src/core/snapshot.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import { registerRoomHandlers } from "../../src/main/room/room-handlers.ts";
import { LIST_CSP, ROOM_CSP } from "../../src/main/web-preferences.ts";
import { type Check, differs, forbids, type Mutation, mutationGaps, oldView, slashCode } from "./rule-sources.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p: string[]): string => readFileSync(join(APP, ...p), "utf8");
const code = slashCode;
// The negative and exact-list checks on the preloads and the room's scripts, each in two views
// (rule-sources.ts, issue #861): `slashCode`, as before, and the file with only its real comments
// out, so a "//" or "/*" in a string hides nothing from them. The last test shows each catches that.
const sortedSet = (re: RegExp) => (v: string): (string | undefined)[] => [...new Set([...v.matchAll(re)].map((m) => m[1]))].sort();
const R = {
  roomNames: differs((v) => [...v.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort(), ["back", "endClass", "follow", "forward", "mixReport", "next", "onMix", "onRemote", "onUpdate", "pause", "previous", "remoteState", "resume", "start", "startRemote", "state", "stopRemote", "undo"], code),
  invoked: differs(sortedSet(/ipcRenderer\.invoke\((\w+)/g), ["CH_ROOM_COMMAND", "CH_ROOM_END", "CH_ROOM_MIX_REPORT", "CH_ROOM_REMOTE_START", "CH_ROOM_REMOTE_STATE", "CH_ROOM_REMOTE_STOP", "CH_ROOM_STATE"], code),
  pushes: differs((v) => [...v.matchAll(/ipcRenderer\.on\((\w+)/g)].map((m) => m[1]), ["CH_ROOM_UPDATE", "CH_ROOM_REMOTE_UPDATE", "CH_ROOM_MIX"], code),
  sends: forbids(/ipcRenderer\.(send|sendSync|postMessage|addListener|once)\b/, code),
  presenterRoom: forbids(/CH_ROOM_|room:/, code),
  used: differs(sortedSet(/api\.(\w+)/g), ["back", "endClass", "follow", "forward", "mixReport", "next", "onMix", "onRemote", "onUpdate", "pause", "previous", "remoteState", "resume", "start", "startRemote", "state", "undo"], code),
  writesPage: forbids(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|player\.|\bfetch\b|XMLHttpRequest|WebSocket/, code),
  takesRoom: differs((v) => [...v.matchAll(/\.room\b|\["room"\]|\['room'\]/g)].map((m) => m[0]), [".room"], code),
  bareApi: differs((v) => [...v.matchAll(/\bapi\b(?!\.\w)/g)].length, 1, code),
  aroundApi: forbids(/\bapi\s*\[|\bapi\?\.|globalThis|\bself\b|\btop\b\.|\bparent\b\./, code),
  roomElsewhere: forbids(/\.room\b|\[["']room["']\]|\bapi\b|\bwindow\s*\[/, code),
} satisfies Record<string, Check>;
const at = (path: string): string => read(...path.split("/"));
const holds = (check: keyof typeof R, path: string): boolean => R[check](path, at(path));

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

test("a frame carries the class, the clock view, the link view and the band's routes, and nothing else of the snapshot", () => {
  assert.deepEqual(Object.keys(roomFrameOf(SNAP)).sort(), ["band", "doc", "link", "mix", "pattern", "playlistNotLoaded", "view"]);
  assert.deepEqual(roomFrameOf(SNAP), { doc: SNAP.doc, view: SNAP.view, link: SNAP.link, band: null, pattern: null, playlistNotLoaded: false, mix: null });
  // The routes are rebuilt from closed values: nothing else the snapshot holds there goes along.
  const pattern = { position: "standing", beat: 3, beatsLeft: 6, nextPosition: "seated", secret: "QQQQ-QQQQ" };
  assert.deepEqual(roomFrameOf({ ...SNAP, pattern } as unknown as Snapshot).pattern, { position: "standing", beat: 3, beatsLeft: 6, nextPosition: "seated" });
  const band = { start: "music", pause: "handover", resume: "clock", next: "music", previous: "nope", extra: "QQQQ-QQQQ" };
  const framed = roomFrameOf({ ...SNAP, band } as unknown as Snapshot);
  assert.deepEqual(framed.band, { start: "music", pause: "handover", resume: "clock", next: "music", previous: "clock" });
  // The mix line is a closed copy too: its words and shape only.
  const mix = { text: "Playing the mix", shape: "dot", url: "cbp-mix://play/00", account: "QQQQ" } as unknown as MixLine;
  assert.deepEqual(roomFrameOf(SNAP, mix).mix, { text: "Playing the mix", shape: "dot" });
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
  const PRELOAD = "src/preload/room-preload.ts";
  const src = code(at(PRELOAD));
  for (const check of ["roomNames", "invoked", "pushes", "sends"] as const) assert.ok(!holds(check, PRELOAD), check);
  // The one function that takes values from the page sends exactly the report's four fields, rebuilt.
  assert.match(src, /invoke\(CH_ROOM_MIX_REPORT, \{ seq: Number\(seq\), positionMs: Number\(positionMs\), playing: playing === true, failed: failed === true, durationMs: typeof durationMs === "number" && Number\.isFinite\(durationMs\) \? durationMs : null \}\)/);
  assert.deepEqual(ROOM_CHANNELS, [CH_ROOM_STATE, CH_ROOM_COMMAND, CH_ROOM_END, CH_ROOM_REMOTE_STATE, CH_ROOM_REMOTE_START, CH_ROOM_REMOTE_STOP, CH_ROOM_MIX_REPORT]);
  assert.deepEqual(ROOM_PUSH_CHANNELS, [CH_ROOM_UPDATE, CH_ROOM_REMOTE_UPDATE, CH_ROOM_MIX]);
  // The presenter's preload knows nothing of the room.
  assert.ok(!holds("presenterRoom", "src/preload/preload.ts"));
  assert.equal(new Set([...ROOM_CHANNELS, ...ROOM_PUSH_CHANNELS]).size, ROOM_CHANNELS.length + ROOM_PUSH_CHANNELS.length);
});

test("room.html carries exactly the room's policy, before any script, and no inline script, style or handler", () => {
  const html = read("src", "renderer", "room.html");
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(m, "CSP meta tag missing");
  assert.equal(m[1], ROOM_CSP);
  assert.equal(ROOM_CSP, LIST_CSP.replace("media-src 'none'", "media-src cbp-mix:"));
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"));
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)|<style|\sstyle=|\son[a-z]+=/i);
  assert.doesNotMatch(ROOM_CSP, /unsafe-inline|unsafe-eval|https?:|data:|blob:|\*/);
  for (const k of ["connect-src", "object-src", "frame-src", "worker-src", "img-src"]) assert.match(ROOM_CSP, new RegExp(`${k} 'none'`), k);
  assert.match(ROOM_CSP, /(^|; )media-src cbp-mix:(;|$)/);
  // The one <audio>, with no source in the page: main gives it the play URL.
  assert.deepEqual([...html.matchAll(/<(audio|video|source|track)\b[^>]*>/g)].map((x) => x[0]), ['<audio id="mix" preload="auto">']);
});

test("the room page uses only the room's fixed calls (issue #198: the band's commands, End class, the phone remote)", () => {
  assert.ok(!holds("used", "src/renderer/room.ts"));
  for (const f of ["room.ts", "room-band.ts", "room-qr.ts", "room-mix.ts"]) assert.ok(!holds("writesPage", `src/renderer/${f}`), f);
});

test("the preload is reached once, by name, in room.ts only: no other way round the list of calls", () => {
  const room = code(read("src", "renderer", "room.ts"));
  // The one place the preload is taken, and the only bare `api` (no alias, no passing it on).
  assert.ok(!holds("takesRoom", "src/renderer/room.ts"));
  assert.ok(!holds("bareApi", "src/renderer/room.ts"));
  assert.match(room, /const api = \(window as unknown as \{ room: RoomApi \}\)\.room;/);
  for (const f of ["room.ts", "room-band.ts", "room-qr.ts", "room-mix.ts"]) assert.ok(!holds("aroundApi", `src/renderer/${f}`), f);
  for (const f of ["room-band.ts", "room-qr.ts", "room-mix.ts"]) assert.ok(!holds("roomElsewhere", `src/renderer/${f}`), f);
});

test('each check on the preloads and the room\'s scripts catches code a "//" or "/*" in a string hides (issue #861)', () => {
  const ROOM_PRELOAD = ["src/preload/room-preload.ts", "  state: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_STATE),"] as const;
  const PRESENTER = ["src/preload/preload.ts", "  getState: (): Promise<unknown> => ipcRenderer.invoke(CH_STATE),"] as const;
  const ROOM_TS = ["src/renderer/room.ts", 'import "./room-band.css";'] as const;
  const BAND = ["src/renderer/room-band.ts", 'import * as M from "../core/room/band-model.ts";'] as const;
  const QR = ["src/renderer/room-qr.ts", 'import { encodeQr } from "../core/qr/qr-encode.ts";'] as const;
  const hidden = (check: keyof typeof R, [path, anchor]: readonly [string, string], after: string): Mutation => [check, path, anchor, `${anchor} const s = "//"; ${after}`, true];
  const spanned = (check: keyof typeof R, [path, anchor]: readonly [string, string], line: string): Mutation => [check, path, anchor, `${anchor}\nconst s = "/*";\n${line}\nconst t = "*/";`, true];
  const table: readonly Mutation[] = [
    spanned("roomNames", ROOM_PRELOAD, "  steal: () => 1,"),
    hidden("invoked", ROOM_PRELOAD, "ipcRenderer.invoke(CH_LIST_START);"),
    hidden("pushes", ROOM_PRELOAD, "ipcRenderer.on(CH_UPDATE, f);"),
    hidden("sends", ROOM_PRELOAD, 'ipcRenderer.send("x");'),
    hidden("presenterRoom", PRESENTER, "ipcRenderer.invoke(CH_ROOM_END);"),
    hidden("used", ROOM_TS, "api.unpair();"),
    hidden("writesPage", QR, "el.innerHTML = x;"),
    hidden("takesRoom", ROOM_TS, 'const r = window["room"];'),
    hidden("bareApi", ROOM_TS, "keep(api);"),
    hidden("aroundApi", ROOM_TS, "globalThis.x = 1;"),
    hidden("roomElsewhere", BAND, "const r = window.room;"),
  ];
  assert.deepEqual(mutationGaps(table, new Map(Object.entries(R)), at, oldView(code)), []);
  assert.deepEqual([...new Set(table.map(([c]) => c))].sort(), Object.keys(R).sort());
});
