// The room window's phone-remote slot joined to the live client (issue #202): the room's Phone
// remote button and End class drive the live service; the room is told the join code, the phones
// connected and the site, and never a control code, the host token or anything else of the
// session (ADR 0005 sections 2 and 3, rule 14); and nothing starts the phone remote by itself.
// Through the real room handlers and the real live service, on the fake live process. No network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import { CH_ROOM_COMMAND, CH_ROOM_END, CH_ROOM_REMOTE_START, CH_ROOM_REMOTE_STATE, CH_ROOM_REMOTE_STOP, CH_ROOM_STATE } from "../../src/core/channels.ts";
import type { RemoteView } from "../../src/core/room/remote.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import { liveRoomRemote } from "../../src/main/live/room-remote.ts";
import { registerRoomHandlers } from "../../src/main/room/room-handlers.ts";
import { CONTROL_CODE, DEVICE_TOKEN, HOST_TOKEN, JOIN_CODE, ORIGIN, rig, SESSION_ID } from "./live-relay.ts";
import type { Rig } from "./live-relay.ts";

const ROOM = { roomId: 9, roomUrl: "file:///app/dist/room.html" };
const ev = { sender: { id: 9 }, senderFrame: { parent: null, url: ROOM.roomUrl } } as unknown as IpcMainInvokeEvent;

function roomRig(r: Rig = rig()) {
  const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
  const remote = liveRoomRemote(r.live);
  const pushed: RemoteView[] = [];
  // As main.ts: every change goes to the room window, and every snapshot refreshes the slot.
  remote.watch((v) => void pushed.push(v));
  r.controller.watch(() => remote.refresh());
  let ended = 0;
  registerRoomHandlers(bus, () => ROOM, r.controller, { endClass: () => void (ended += 1, remote.stop()), remote, log: () => undefined });
  const call = (ch: string, raw?: unknown): unknown => handlers.get(ch)!(ev, raw);
  return { r, remote, pushed, call, ended: () => ended };
}

const ON = (phones: 0 | 1 | 2, reconnecting = false): RemoteView => ({ slot: "on", joinCode: JOIN_CODE, phones, reconnecting, site: ORIGIN });
const sessionPosts = (r: Rig) => r.requests.filter((q) => q.method === "POST" && q.path === "/api/live/sessions");

test("the phone remote never starts by itself: not at the start, nor on asking for the slot, a snapshot, a new class or time passing", async () => {
  const x = roomRig();
  assert.deepEqual(x.call(CH_ROOM_REMOTE_STATE), { slot: "available", note: "none" });
  for (let i = 0; i < 5; i++) {
    x.call(CH_ROOM_REMOTE_STATE);
    x.call(CH_ROOM_STATE);
    x.call(CH_ROOM_COMMAND, { type: "start" });
    x.call(CH_ROOM_COMMAND, { type: "pause" });
    x.remote.refresh();
    x.r.live.tick();
    await x.r.advance(30_000);
  }
  x.r.live.classChanged();
  x.remote.stop();
  await x.r.advance(60_000);
  assert.deepEqual(x.r.requests, []);
  assert.deepEqual(x.r.sockets, []);
  assert.deepEqual(x.call(CH_ROOM_REMOTE_STATE), { slot: "available", note: "none" });
});

test("Phone remote on the room screen starts the live session; the room is shown Starting, then the join code with the site", async () => {
  const x = roomRig();
  assert.deepEqual(x.call(CH_ROOM_REMOTE_START), { slot: "starting" });
  assert.equal(sessionPosts(x.r).length, 1);
  assert.equal(sessionPosts(x.r)[0]!.origin, ORIGIN);
  await x.r.advance(0);
  // Connecting: the code is known but not yet shown.
  assert.deepEqual(x.call(CH_ROOM_REMOTE_STATE), { slot: "starting" });
  x.r.socket().open();
  x.r.socket().server({ v: 1, type: "welcome", role: "host" });
  assert.deepEqual(x.call(CH_ROOM_REMOTE_STATE), ON(0));
  assert.deepEqual(x.pushed, [{ slot: "starting" }, ON(0)]);
  // A second press while it runs starts no second session.
  assert.deepEqual(x.call(CH_ROOM_REMOTE_START), ON(0));
  assert.equal(sessionPosts(x.r).length, 1);
  // The presenter's panel sees the same session.
  assert.equal(x.r.live.view().classCode, JOIN_CODE);
});

test("the slot follows the session: phones joining and leaving, a lost connection, the server ending it", async () => {
  const x = roomRig();
  x.call(CH_ROOM_REMOTE_START);
  await x.r.advance(0);
  x.r.socket().open();
  x.r.socket().server({ v: 1, type: "welcome", role: "host" });
  x.r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "sign_in" });
  assert.deepEqual(x.pushed.at(-1), ON(1));
  x.r.socket().server({ v: 1, type: "controller_joined", slot: 2, via: "sign_in" });
  assert.deepEqual(x.pushed.at(-1), ON(2));
  x.r.socket().server({ v: 1, type: "controller_left", slot: 2, via: "sign_in" });
  assert.deepEqual(x.pushed.at(-1), ON(1));
  x.r.socket().drop(1006);
  assert.deepEqual(x.pushed.at(-1), ON(0, true));
  await x.r.advance(1000);
  x.r.socket().open();
  x.r.socket().server({ v: 1, type: "welcome", role: "host" });
  assert.deepEqual(x.pushed.at(-1), ON(0));
  x.r.socket().server({ v: 1, type: "ended", reason: "expired" });
  assert.deepEqual(x.pushed.at(-1), { slot: "available", note: "ended" });
  // Each change is told once.
  for (let i = 1; i < x.pushed.length; i++) assert.notDeepEqual(x.pushed[i], x.pushed[i - 1]);
});

test("in use elsewhere, and no answer from the site, as the spec has them", async () => {
  const full = roomRig();
  full.r.answer = { kind: "http", status: 409, body: { error: "sessions_full" }, retryAfterS: null };
  full.call(CH_ROOM_REMOTE_START);
  await full.r.advance(0);
  assert.deepEqual(full.call(CH_ROOM_REMOTE_STATE), { slot: "available", note: "in_use" });
  const away = roomRig();
  away.r.answer = { kind: "unreachable" };
  away.call(CH_ROOM_REMOTE_START);
  await away.r.advance(0);
  assert.deepEqual(away.call(CH_ROOM_REMOTE_STATE), { slot: "available", note: "unreachable" });
});

test("Can't reach site: nothing tries again by itself; each press of the button makes exactly one new start", async () => {
  const x = roomRig();
  const answers = x.r.answer;
  x.r.answer = { kind: "unreachable" };
  assert.deepEqual(x.call(CH_ROOM_REMOTE_START), { slot: "starting" });
  await x.r.advance(0);
  assert.deepEqual(x.call(CH_ROOM_REMOTE_STATE), { slot: "available", note: "unreachable" });
  assert.deepEqual(x.pushed, [{ slot: "starting" }, { slot: "available", note: "unreachable" }]);
  assert.equal(sessionPosts(x.r).length, 1);
  // No press: asking for the slot, snapshots, room commands, refreshes, ticks and ten minutes start nothing.
  for (let i = 0; i < 20; i++) {
    x.call(CH_ROOM_REMOTE_STATE);
    x.call(CH_ROOM_STATE);
    x.call(CH_ROOM_COMMAND, { type: "pause" });
    x.remote.refresh();
    x.r.live.tick();
    await x.r.advance(30_000);
  }
  assert.equal(sessionPosts(x.r).length, 1, "a start without a press");
  assert.deepEqual(x.r.sockets, []);
  assert.deepEqual(x.call(CH_ROOM_REMOTE_STATE), { slot: "available", note: "unreachable" });
  // A press that again gets no answer: one new start, and the note again.
  assert.deepEqual(x.call(CH_ROOM_REMOTE_START), { slot: "starting" });
  assert.equal(sessionPosts(x.r).length, 2);
  await x.r.advance(0);
  assert.deepEqual(x.call(CH_ROOM_REMOTE_STATE), { slot: "available", note: "unreachable" });
  await x.r.advance(600_000);
  assert.equal(sessionPosts(x.r).length, 2);
  // A press once the site answers: one new start, and the session runs.
  x.r.answer = answers;
  assert.deepEqual(x.call(CH_ROOM_REMOTE_START), { slot: "starting" });
  assert.equal(sessionPosts(x.r).length, 3);
  await x.r.advance(0);
  x.r.socket().open();
  x.r.socket().server({ v: 1, type: "welcome", role: "host" });
  assert.deepEqual(x.call(CH_ROOM_REMOTE_STATE), ON(0));
  assert.equal(sessionPosts(x.r).length, 3);
  for (const v of x.pushed) assert.ok(!JSON.stringify(v).includes(HOST_TOKEN) && !JSON.stringify(v).includes(SESSION_ID), JSON.stringify(v));
});

test("not paired: the slot is absent and the button starts nothing on the backend", async () => {
  const r = rig();
  r.paired = false;
  const x = roomRig(r);
  assert.deepEqual(x.call(CH_ROOM_REMOTE_STATE), { slot: "absent" });
  x.call(CH_ROOM_REMOTE_START);
  await x.r.advance(0);
  assert.deepEqual(x.r.requests, []);
  assert.deepEqual(x.call(CH_ROOM_REMOTE_STATE), { slot: "absent" });
});

test("stopping from the room, and End class, end the live session over the host's connection", async () => {
  for (const how of ["stop", "end"] as const) {
    const x = roomRig();
    x.call(CH_ROOM_REMOTE_START);
    await x.r.advance(0);
    const s = x.r.socket();
    s.open();
    s.server({ v: 1, type: "welcome", role: "host" });
    const answer = x.call(how === "stop" ? CH_ROOM_REMOTE_STOP : CH_ROOM_END);
    assert.deepEqual(answer, how === "stop" ? { slot: "available", note: "ended" } : true, how);
    assert.ok(s.sent.some((m) => (m as { type?: string }).type === "end"), how);
    // The host's connection is kept until the live process answers `ended` (#211, farewell.ts).
    s.server({ v: 1, type: "ended", reason: "host_ended" });
    assert.equal(s.closedByApp, true, how);
    assert.deepEqual(x.call(CH_ROOM_REMOTE_STATE), { slot: "available", note: "ended" }, how);
    assert.equal(x.ended(), how === "end" ? 1 : 0);
  }
});

test("isolation: no room channel and no push ever carries the control code, the host token, the session id or the device token", async () => {
  const x = roomRig();
  const seen: unknown[] = [];
  const ask = (): void => {
    seen.push(x.call(CH_ROOM_REMOTE_STATE), x.call(CH_ROOM_STATE));
  };
  ask();
  seen.push(x.call(CH_ROOM_REMOTE_START));
  await x.r.advance(0);
  ask();
  x.r.socket().open();
  ask();
  x.r.socket().server({ v: 1, type: "welcome", role: "host" });
  ask();
  // With a second display the presenter asks for a control code; the room sees none of it.
  x.r.live.makeCode();
  x.r.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  assert.equal(x.r.live.view().controlCode, CONTROL_CODE, "the presenter has the code");
  ask();
  x.r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  x.r.socket().server({ v: 1, type: "controller_joined", slot: 2, via: "sign_in" });
  seen.push(x.call(CH_ROOM_COMMAND, { type: "start" }));
  ask();
  for (let i = 0; i < 10; i++) {
    await x.r.advance(200);
    x.r.live.tick();
    ask();
  }
  x.r.socket().drop(1006);
  ask();
  await x.r.advance(1000);
  x.r.socket().open();
  x.r.socket().server({ v: 1, type: "welcome", role: "host" });
  x.r.live.makeCode();
  x.r.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  ask();
  seen.push(x.call(CH_ROOM_REMOTE_STOP));
  ask();
  seen.push(x.call(CH_ROOM_END));
  seen.push(...x.pushed);
  assert.ok(x.pushed.some((v) => v.slot === "on" && v.phones === 2), "the room was shown the running session");
  const texts = seen.map((s) => JSON.stringify(s));
  for (const t of texts) {
    for (const secret of [CONTROL_CODE, CONTROL_CODE.replace("-", ""), HOST_TOKEN, SESSION_ID, DEVICE_TOKEN, "cbp_"]) assert.ok(!t.includes(secret), `${secret} in ${t.slice(0, 80)}`);
  }
  // What the slot holds is the spec's fields and nothing else.
  for (const v of x.pushed) for (const k of Object.keys(v)) assert.ok(["slot", "note", "joinCode", "phones", "reconnecting", "site"].includes(k), k);
});
