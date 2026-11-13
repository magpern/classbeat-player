// The room window's one-screen controls (issue #197; room-2d.md, "What the room window needs from
// the desktop shell"): a closed set of clock commands, End class, and the phone remote's start, stop
// and slot. Every new channel answers only the room window's top frame; a malformed or unknown
// message is refused, changes nothing and is logged without what was sent. ADR 0005's guard: no
// control code, token or controller detail reaches the room window on any room channel.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { IpcMainInvokeEvent } from "electron";
import { CH_ROOM_COMMAND, CH_ROOM_END, CH_ROOM_REMOTE_START, CH_ROOM_REMOTE_STATE, CH_ROOM_REMOTE_STOP, CH_ROOM_STATE } from "../../src/core/channels.ts";
import type { ClockCommand } from "../../src/core/commands.ts";
import { ROOM_CHANNELS } from "../../src/core/ipc-policy.ts";
import { parseRoomCommand, ROOM_COMMAND_TYPES } from "../../src/core/room/commands.ts";
import { roomFrameOf } from "../../src/core/room/frame.ts";
import { NO_REMOTE, REMOTE_ABSENT, remoteViewOf } from "../../src/core/room/remote.ts";
import type { RemoteView, RoomRemote } from "../../src/core/room/remote.ts";
import type { Snapshot } from "../../src/core/snapshot.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import { refusalLine, registerRoomHandlers } from "../../src/main/room/room-handlers.ts";
import { REPO } from "./fixtures.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p: string[]): string => readFileSync(join(APP, ...p), "utf8");
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ACCEPTED: readonly ClockCommand[] = [
  { type: "start" },
  { type: "pause" },
  { type: "resume" },
  { type: "previous" },
  { type: "next" },
  { type: "jump", deltaMs: 5000 },
  { type: "jump", deltaMs: -5000 },
  { type: "undo" },
  { type: "follow" },
];

// A marker in every refused payload: it must never be logged.
const LEAK = "payload-marker-7f3a";
const REFUSED: readonly [string, unknown][] = [
  ["the manual clock (presenter only)", { type: "manual" }],
  ["picking an occurrence (presenter only)", { type: "pick", songIndex: 0 }],
  ["a music command (presenter only)", { type: "music", action: "next" }],
  ["an unknown type", { type: LEAK }],
  ["an end on the command channel", { type: "end" }],
  ["a free-form step", { type: "jump", deltaMs: 1000 }],
  ["a step as text", { type: "jump", deltaMs: "5000" }],
  ["an extra key", { type: "start", note: LEAK }],
  ["a missing type", { note: LEAK }],
  ["text", `start ${LEAK}`],
  ["an array", [{ type: "start" }, LEAK]],
  ["null", null],
  ["nothing", undefined],
  ["a number", 5000],
  ["an object with a prototype", Object.assign(Object.create({ type: "start" }) as object, { x: LEAK })],
  ["an equipment-like command", { type: "resistance", level: LEAK }],
];

test("the room's clock commands: exactly the band's and the keyboard's, each accepted as itself", () => {
  assert.deepEqual([...ROOM_COMMAND_TYPES], ["start", "pause", "resume", "previous", "next", "jump", "undo", "follow"]);
  for (const c of ACCEPTED) assert.deepEqual(parseRoomCommand(c), c, JSON.stringify(c));
});

test("anything else is refused by the room's parser", () => {
  for (const [label, v] of REFUSED) assert.equal(parseRoomCommand(v), null, label);
});

const ROOM = { roomId: 9, roomUrl: "file:///app/dist/room.html" };
const SNAP = { loadId: 1, fileName: "f.json", doc: { d: 1 }, view: { v: 1 }, link: { l: 1 }, controls: { c: 1 }, error: null } as unknown as Snapshot;

function rig(remoteView: () => RemoteView = () => REMOTE_ABSENT, snap: Snapshot = SNAP) {
  const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
  const commands: ClockCommand[] = [];
  const acts: string[] = [];
  const logs: string[] = [];
  const remote: RoomRemote = { view: remoteView, start: () => void acts.push("start"), stop: () => void acts.push("stop"), watch: () => undefined };
  registerRoomHandlers(bus, () => ROOM, { snapshot: () => snap, command: (c) => (commands.push(c), snap) }, { endClass: () => void acts.push("end"), remote, log: (l) => void logs.push(l) });
  const ev = (id = 9, url = ROOM.roomUrl, parent: unknown = null): IpcMainInvokeEvent => ({ sender: { id }, senderFrame: { parent, url } }) as unknown as IpcMainInvokeEvent;
  const call = (ch: string, raw?: unknown, e = ev()): unknown => handlers.get(ch)!(e, raw);
  return { handlers, commands, acts, logs, ev, call };
}

test("every room channel has a handler, and the room's commands reach the clock as sent", () => {
  const r = rig();
  assert.deepEqual([...r.handlers.keys()].sort(), [...ROOM_CHANNELS].sort());
  for (const c of ACCEPTED) assert.deepEqual(r.call(CH_ROOM_COMMAND, c), roomFrameOf(SNAP));
  assert.deepEqual(r.commands, ACCEPTED);
  assert.deepEqual(r.logs, []);
});

test("a malformed or unknown command is refused, changes nothing, and is logged without its payload", () => {
  const r = rig();
  for (const [label, v] of REFUSED) assert.equal(r.call(CH_ROOM_COMMAND, v), null, label);
  assert.deepEqual(r.commands, []);
  assert.deepEqual(r.logs, REFUSED.map(() => refusalLine(CH_ROOM_COMMAND, "command")));
  for (const l of r.logs) assert.doesNotMatch(l, /payload-marker|resistance|start /);
});

test("End class and the phone remote's channels take no argument: anything sent is refused unread and logged", () => {
  const r = rig();
  for (const ch of [CH_ROOM_END, CH_ROOM_REMOTE_STATE, CH_ROOM_REMOTE_START, CH_ROOM_REMOTE_STOP]) {
    for (const raw of [LEAK, { type: "start" }, null, 0, false, []]) assert.equal(r.call(ch, raw), null, `${ch} ${JSON.stringify(raw)}`);
  }
  assert.deepEqual(r.acts, []);
  assert.equal(r.logs.length, 24);
  for (const l of r.logs) assert.match(l, /^room window: refused a message on room:(end|remote-state|remote-start|remote-stop) \(argument\)$/);
});

test("a message from anything but the room window's top frame is refused on every new channel and logged by its reason", () => {
  const r = rig();
  const others = [r.ev(7), r.ev(9, "file:///app/dist/presenter.html"), r.ev(9, ROOM.roomUrl, {})];
  for (const ch of [CH_ROOM_COMMAND, CH_ROOM_END, CH_ROOM_REMOTE_STATE, CH_ROOM_REMOTE_START, CH_ROOM_REMOTE_STOP]) {
    for (const e of others) assert.equal(r.call(ch, ch === CH_ROOM_COMMAND ? { type: "start" } : undefined, e), null, ch);
  }
  assert.deepEqual(r.commands, []);
  assert.deepEqual(r.acts, []);
  assert.equal(r.logs.length, 15);
  for (const l of r.logs) assert.match(l, /\(sender\)$/);
});

test("End class ends the class once; the phone remote starts and stops on request and answers with its slot", () => {
  const on: RemoteView = { slot: "on", joinCode: "BCDF-GHJK", phones: 2, reconnecting: false };
  const r = rig(() => on);
  assert.equal(r.call(CH_ROOM_END), true);
  assert.deepEqual(r.call(CH_ROOM_REMOTE_STATE), on);
  assert.deepEqual(r.call(CH_ROOM_REMOTE_START), on);
  assert.deepEqual(r.call(CH_ROOM_REMOTE_STOP), on);
  assert.deepEqual(r.acts, ["end", "start", "stop"]);
  // Asking for the slot starts nothing.
  assert.deepEqual(rig(() => on).acts, []);
});

test("this build has no live client: the slot is absent, and start and stop do nothing", () => {
  assert.deepEqual(NO_REMOTE.view(), { slot: "absent" });
  NO_REMOTE.start();
  NO_REMOTE.stop();
  assert.deepEqual(NO_REMOTE.view(), { slot: "absent" });
});

test("the slot the room window is sent: each state as itself, anything else as Absent", () => {
  const good: RemoteView[] = [
    { slot: "absent" },
    { slot: "available", note: "none" },
    { slot: "available", note: "in_use" },
    { slot: "available", note: "ended" },
    { slot: "starting" },
    { slot: "on", joinCode: "BCDF-GHJK", phones: 0, reconnecting: false },
    { slot: "on", joinCode: "ZZZZ-XWVT", phones: 1, reconnecting: true },
    { slot: "on", joinCode: "BCDF-GHJK", phones: 2, reconnecting: false },
  ];
  for (const v of good) assert.deepEqual(remoteViewOf(v), v);
  const bad: unknown[] = [
    null,
    "on",
    { slot: "running" },
    { slot: "available", note: "rider joined" },
    { slot: "available" },
    { slot: "on", joinCode: "bcdf-ghjk", phones: 1, reconnecting: false },
    { slot: "on", joinCode: "BCDF-GHJK-ZZZZ", phones: 1, reconnecting: false },
    { slot: "on", joinCode: "cbp_hst_xxxxxxxx", phones: 1, reconnecting: false },
    { slot: "on", joinCode: "BCDF-GHJK", phones: 3, reconnecting: false },
    { slot: "on", joinCode: "BCDF-GHJK", phones: 1 },
    { slot: "on", phones: 1, reconnecting: false },
  ];
  for (const v of bad) assert.deepEqual(remoteViewOf(v as RemoteView), REMOTE_ABSENT, JSON.stringify(v));
});

// ADR 0005, section 7: "the control code is sent only on the presenter's channel, never on the
// room window's (`room-preload`)", extended to every room channel (room-2d.md, C10).
const SECRETS = ["QQQQ-QQQQ", "cbp_hst_", "cbp_ctl_", "cbp_rdr_", "cbp_dev_", "secret-account@example.invalid", "Ann's phone"];
const HOSTILE = {
  slot: "on",
  joinCode: "BCDF-GHJK",
  phones: 1,
  reconnecting: false,
  controlCode: "QQQQ-QQQQ",
  control_code: { v: 1, type: "control_code", code: "QQQQ-QQQQ", expiresInMs: 120000 },
  code: "QQQQ-QQQQ",
  hostToken: `cbp_hst_${"a".repeat(43)}`,
  controllers: [{ slot: 1, token: `cbp_ctl_${"b".repeat(43)}`, device: "Ann's phone" }],
  riderToken: "cbp_rdr_x",
  deviceToken: "cbp_dev_x",
  account: "secret-account@example.invalid",
} as unknown as RemoteView;
const HOSTILE_SNAP = { ...SNAP, controlCode: "QQQQ-QQQQ", hostToken: "cbp_hst_y", live: HOSTILE, controls: { code: "QQQQ-QQQQ" } } as unknown as Snapshot;

test("no control code, token or controller detail reaches the room window on any room channel", () => {
  const r = rig(() => HOSTILE, HOSTILE_SNAP);
  const answers = ROOM_CHANNELS.map((ch) => r.call(ch, ch === CH_ROOM_COMMAND ? { type: "next" } : undefined));
  // And the two pushes, built the way the room window builds them (checked on its source below).
  answers.push(roomFrameOf(HOSTILE_SNAP), remoteViewOf(HOSTILE));
  const sent = JSON.stringify(answers);
  for (const s of SECRETS) assert.ok(!sent.includes(s), s);
  assert.deepEqual(remoteViewOf(HOSTILE), { slot: "on", joinCode: "BCDF-GHJK", phones: 1, reconnecting: false });
  assert.deepEqual(r.call(CH_ROOM_STATE), { doc: SNAP.doc, view: SNAP.view, link: SNAP.link });
});

const ROOM_SOURCES = ["preload/room-preload.ts", "main/room/room-handlers.ts", "main/room/room-window.ts", "core/room/remote.ts", "core/room/commands.ts", "core/room/frame.ts", "renderer/room.ts"];

test("the room's sources name no control code, token or controller, and each push goes through its filter", () => {
  for (const p of ROOM_SOURCES) assert.doesNotMatch(code(read("src", ...p.split("/"))), /control.?code|token|cbp_|\bcontrollers\b|controller_|make_code|hostToken/i, p);
  const win = code(read("src", "main", "room", "room-window.ts"));
  assert.deepEqual([...win.matchAll(/\bpush\(([^)]*\))\)/g)].map((m) => m[1]), ["CH_ROOM_UPDATE, roomFrameOf(s)", "CH_ROOM_REMOTE_UPDATE, remoteViewOf(v)"]);
  assert.deepEqual([...win.matchAll(/\.send\((\w+)/g)].map((m) => m[1]), ["channel"]);
});

test("no room command is an equipment command, and none plays audio", () => {
  const words = readFileSync(join(REPO, "schema", "live", "guard", "equipment-words.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  for (const t of ROOM_COMMAND_TYPES) assert.ok(!words.includes(t), t);
  for (const p of ROOM_SOURCES) assert.doesNotMatch(code(read("src", ...p.split("/"))), /\bnew\s+Audio\b|AudioContext|\.play\(\)|writeValue|navigator\.bluetooth/, p);
});
