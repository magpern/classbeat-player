// The live client in the main process against a fake live process (test/unit/live-relay.ts): the
// start request with the device token, the host token only in hello, the state on welcome, the
// reconnect with the token in memory, host operations, a phone's command down the presenter's
// path, and a dropped connection that leaves the class as it was. Fakes only: no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTROL_CODE, DEVICE_TOKEN, HOST_TOKEN, JOIN_CODE, ORIGIN, rig, started } from "./live-relay.ts";
import { validCommandResult, validCompanionState } from "./live-rig.ts";

const ofType = (sent: unknown[], type: string): Record<string, unknown>[] => sent.filter((m): m is Record<string, unknown> => (m as { type?: string }).type === type);

test("off until asked; start asks the backend once, with the device token in the header only", async () => {
  const r = rig();
  assert.equal(r.live.view().status, "Off");
  assert.equal(r.requests.length, 0);
  assert.equal(r.sockets.length, 0);
  r.live.start();
  await r.advance(0);
  assert.equal(r.requests.length, 1);
  assert.deepEqual(r.requests[0], { origin: ORIGIN, method: "POST", path: "/api/live/sessions", token: DEVICE_TOKEN });
  assert.equal(r.socket().url, "wss://player.example.test/api/live/ws");
  assert.ok(!r.socket().url.includes(HOST_TOKEN) && !r.socket().url.includes(DEVICE_TOKEN));
});

test("hello carries the host token, and nothing else ever does", async () => {
  const r = await started();
  const [hello] = r.socket().sent;
  assert.deepEqual(hello, { v: 1, type: "hello", token: HOST_TOKEN });
  await r.advance(3000);
  for (const m of r.socket().sent.slice(1)) assert.ok(!JSON.stringify(m).includes(HOST_TOKEN));
  assert.ok(!JSON.stringify(r.live.view()).includes(HOST_TOKEN));
});

test("on welcome the state goes at once, valid, then at least once a second", async () => {
  const r = await started();
  const states = ofType(r.socket().sent, "companion_state");
  assert.equal(states.length, 1);
  assert.ok(validCompanionState(states[0]), JSON.stringify(validCompanionState.errors));
  await r.advance(3000);
  const later = ofType(r.socket().sent, "companion_state");
  assert.ok(later.length >= 4, `${later.length} states in 3 s`);
  assert.deepEqual(
    later.map((s) => s.seq),
    later.map((_, i) => i),
  );
  assert.ok(later.every((s) => s.run === later[0].run));
});

test("not paired, or no class open: nothing is asked and the panel says why", async () => {
  const r = rig();
  r.paired = false;
  assert.equal(r.live.start().detail, "Pair this computer to use a phone remote");
  r.paired = true;
  r.classOpen = false;
  assert.equal(r.live.start().detail, "Open a class first");
  await r.advance(0);
  assert.equal(r.requests.length, 0);
});

test("the server unreachable or full: the panel says so and the class goes on", async () => {
  const r = rig();
  r.answer = { kind: "unreachable" };
  r.live.start();
  await r.advance(0);
  assert.equal(r.live.view().detail, "The server cannot be reached. The class goes on");
  assert.equal(r.sockets.length, 0);
  r.answer = { kind: "http", status: 409, body: { error: "sessions_full" }, retryAfterS: null };
  r.live.start();
  await r.advance(0);
  assert.match(r.live.view().detail ?? "", /^Three phone remotes/);
});

test("a dropped connection: reconnecting after 1 s with the same token, the class clock untouched", async () => {
  const r = await started();
  r.controller.command({ type: "start" });
  // The clock's own run (its status and anchor), not when it was last looked at.
  const clock = () => {
    const c = r.controller.read().state.loaded?.clock;
    return c && { status: c.status, anchorMs: c.anchorMs, anchorAt: c.anchorAt };
  };
  const before = clock();
  r.socket().drop(1006);
  assert.equal(r.live.view().status, "Reconnecting");
  assert.deepEqual(clock(), before);
  await r.advance(999);
  assert.equal(r.sockets.length, 1);
  await r.advance(1);
  assert.equal(r.sockets.length, 2);
  r.socket().open();
  assert.deepEqual(r.socket().sent[0], { v: 1, type: "hello", token: HOST_TOKEN });
  r.socket().server({ v: 1, type: "welcome", role: "host" });
  assert.equal(r.live.view().status, "On");
  assert.equal(ofType(r.socket().sent, "companion_state").length, 1);
  assert.deepEqual(clock(), before);
});

test("the reconnect refused (the live process restarted): ended, a new one offered, no more tries", async () => {
  const r = await started();
  r.socket().drop(1006);
  await r.advance(1000);
  r.socket().open();
  r.socket().drop(4401);
  const v = r.live.view();
  assert.equal(v.status, "Ended");
  assert.equal(v.canStart, true);
  await r.advance(60_000);
  assert.equal(r.sockets.length, 2);
});

test("a phone joins: Drop beside it, the state at once; Drop sends drop and clears the code", async () => {
  const r = await started();
  await r.advance(300);
  r.live.makeCode();
  assert.deepEqual(ofType(r.socket().sent, "make_code"), [{ v: 1, type: "make_code" }]);
  r.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  assert.equal(r.live.view().controlCode, CONTROL_CODE);
  const statesBefore = ofType(r.socket().sent, "companion_state").length;
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  assert.equal(ofType(r.socket().sent, "companion_state").length, statesBefore + 1);
  assert.deepEqual(r.live.view().slots[0], { slot: 1, text: "Phone 1: steering", canDrop: true });
  r.live.drop(1);
  assert.deepEqual(ofType(r.socket().sent, "drop"), [{ v: 1, type: "drop", slot: 1 }]);
  assert.equal(r.live.view().controlCode, null);
  assert.deepEqual(r.live.view().slots[0], { slot: 1, text: "Phone 1: free", canDrop: false });
});

test("a phone's pause: applied down the presenter's path, answered first, and the line shown", async () => {
  const r = await started();
  r.controller.command({ type: "start" });
  await r.advance(1000);
  const state = ofType(r.socket().sent, "companion_state").at(-1)!;
  assert.ok((state.allowed as string[]).includes("pause"));
  const sentBefore = r.socket().sent.length;
  const id = "AAAAAAAAAAAAAAAAAAAAAQ";
  r.socket().server({ v: 1, type: "command", slot: 1, id, run: state.run, basis: state.seq, action: "pause" });
  const after = r.socket().sent.slice(sentBefore) as Record<string, unknown>[];
  assert.deepEqual(after[0], { v: 1, type: "command_result", slot: 1, id, result: "applied", reason: null });
  assert.ok(validCommandResult(after[0]));
  assert.equal(r.controller.snapshot().view?.status, "paused");
  assert.equal(r.live.view().line, "Phone 1: pause");
  await r.advance(5000);
  assert.equal(r.live.view().line, null);
});

test("a command while the host is reconnecting is never applied later", async () => {
  const r = await started();
  r.controller.command({ type: "start" });
  r.socket().drop(1006);
  await r.advance(1000);
  r.socket().open();
  // Before welcome: the connection is not live, so a command is not taken.
  r.socket().server({ v: 1, type: "command", slot: 1, id: "AAAAAAAAAAAAAAAAAAAAAQ", run: "AAAAAAAAAAAAAAAAAAAAAA", basis: 0, action: "pause" });
  assert.equal(r.controller.snapshot().view?.status, "running");
});

test("End: end is sent, the socket closed on the server's answer, the panel offers a new one", async () => {
  const r = await started();
  const v = r.live.end();
  assert.deepEqual(ofType(r.socket().sent, "end"), [{ v: 1, type: "end" }]);
  // Kept for the live process's answer (#211), then closed by the app.
  assert.equal(r.socket().closedByApp, false);
  assert.equal(r.live.busy(), true);
  r.socket().server({ v: 1, type: "ended", reason: "host_ended" });
  assert.equal(r.socket().closedByApp, true);
  await r.advance(0);
  assert.equal(r.live.busy(), false);
  assert.equal(v.status, "Ended");
  assert.equal(v.canStart, true);
  assert.equal(v.classCode, null);
});

test("another class opened ends the session; stop on quitting ends it too", async () => {
  const r = await started();
  r.live.classChanged();
  assert.deepEqual(ofType(r.socket().sent, "end"), [{ v: 1, type: "end" }]);
  assert.equal(r.live.view().detail, "A new class needs a new phone remote");
  const s = await started();
  s.live.stop();
  assert.deepEqual(ofType(s.socket().sent, "end"), [{ v: 1, type: "end" }]);
});

test("the class code is shown while it runs, with the control page on the pairing's origin", async () => {
  const r = await started();
  const v = r.live.view();
  assert.equal(v.classCode, JOIN_CODE);
  assert.equal(v.controlPage, `${ORIGIN}/control`);
});

test("the host sends only its own messages, within its budget: under 8 a second, at most 4 states", async () => {
  const r = await started();
  r.controller.command({ type: "start" });
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  const at: { t: number; type: string }[] = [];
  const watched = r.socket().sent;
  let seen = watched.length;
  for (let i = 0; i < 100; i++) {
    await r.advance(50);
    r.live.tick();
    for (; seen < watched.length; seen++) at.push({ t: r.now(), type: (watched[seen] as { type: string }).type });
  }
  const HOST_TYPES = ["hello", "companion_state", "command_result", "make_code", "drop", "end"];
  assert.ok(watched.every((m) => HOST_TYPES.includes((m as { type: string }).type)));
  for (const a of at) {
    const inSecond = at.filter((b) => b.t > a.t - 1000 && b.t <= a.t);
    assert.ok(inSecond.length < 8, `${inSecond.length} messages in a second`);
    assert.ok(inSecond.filter((b) => b.type === "companion_state").length <= 4);
  }
});

test("the class code comes from the start answer only: a control code, of the same shape, never changes it", async () => {
  const r = await started();
  assert.equal(r.live.view().classCode, JOIN_CODE);
  r.live.makeCode();
  for (const code of [CONTROL_CODE, "MNPQ-RSTV"]) {
    r.socket().server({ v: 1, type: "control_code", code, expiresInMs: 120_000 });
    assert.equal(r.live.view().classCode, JOIN_CODE);
    assert.equal(r.live.view().controlCode, code);
  }
  // Messages that are not the start answer cannot carry a class code in: each is dropped or read
  // without it.
  r.socket().server({ v: 1, type: "control_code", code: "MNPQ-RSTV", expiresInMs: 120_000, joinCode: "WXZB-CDFG" });
  r.socket().server({ v: 1, type: "welcome", role: "host", joinCode: "WXZB-CDFG" });
  r.socket().server({ v: 1, type: "code_cancelled", reason: "used" });
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  assert.equal(r.live.view().classCode, JOIN_CODE);
  // A reconnect keeps the class code of the session it resumes.
  r.socket().drop(1006);
  await r.advance(1000);
  r.socket().open();
  r.socket().server({ v: 1, type: "welcome", role: "host" });
  r.socket().server({ v: 1, type: "control_code", code: "WXZB-CDFG", expiresInMs: 120_000 });
  assert.equal(r.live.view().classCode, JOIN_CODE);
  assert.equal(r.live.view().controlCode, "WXZB-CDFG");
});
