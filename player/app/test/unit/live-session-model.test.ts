// The host's live session as a pure state machine (core/live/session-model.ts): started only on
// request with a class open and a pairing, the host token only in `hello`, the 1/2/4/8/15 s
// reconnect for 15 minutes, the close codes, the phones' places, the control code and Drop.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import type { HostInbound } from "../../src/core/live/host-wire.ts";
import { BACKOFF_MS, CLOSE_ENDED, CLOSE_HELLO_REFUSED, CLOSE_REPLACED, KEEP_MS, step } from "../../src/core/live/session-model.ts";
import { OFF } from "../../src/core/live/session-types.ts";
import type { LiveEffect, LiveEvent, LiveModel } from "../../src/core/live/session-types.ts";
import { RUN } from "./live-rig.ts";

const TOKEN = `cbp_hst_${randomBytes(32).toString("base64url")}`;
const SESSION = { sessionId: "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b", joinCode: "BCDF-GHJK", hostToken: TOKEN };

function run(events: readonly LiveEvent[], m: LiveModel = OFF, now = 0): { model: LiveModel; effects: LiveEffect[] } {
  const effects: LiveEffect[] = [];
  for (const e of events) {
    const out = step(m, e, now);
    m = out.model;
    effects.push(...out.effects);
  }
  return { model: m, effects };
}

const start: LiveEvent = { type: "start", run: RUN, credential: "ok", classOpen: true };
const answered: LiveEvent = { type: "answer", request: 1, answer: { ok: true, session: SESSION } };
const msg = (message: HostInbound, socket = 1): LiveEvent => ({ type: "message", socket, message });
const live = (): LiveModel => run([start, answered, { type: "open", socket: 1 }, msg({ type: "welcome" })]).model;

test("off at first; a start needs an open class and a pairing that works", () => {
  assert.equal(OFF.phase, "idle");
  assert.deepEqual(run([{ ...start, classOpen: false }]).model.refusal, "no_class");
  assert.deepEqual(run([{ ...start, credential: "none" }]).model.refusal, "not_paired");
  assert.deepEqual(run([{ ...start, credential: "expired" }]).model.refusal, "pair_again");
  for (const e of [{ ...start, classOpen: false }, { ...start, credential: "none" as const }]) assert.deepEqual(run([e]).effects, []);
  assert.deepEqual(run([start]).effects, [{ kind: "post_session", request: 1 }]);
});

test("a refused start says why and connects nothing", () => {
  const r = run([start, { type: "answer", request: 1, answer: { ok: false, refusal: "sessions_full" } }]);
  assert.equal(r.model.phase, "refused");
  assert.equal(r.model.refusal, "sessions_full");
  assert.equal(r.model.session, null);
  assert.deepEqual(r.effects, [{ kind: "post_session", request: 1 }]);
});

test("the host token leaves the model only in hello, on the connection it opened", () => {
  const r = run([start, answered, { type: "open", socket: 1 }]);
  assert.deepEqual(r.effects, [{ kind: "post_session", request: 1 }, { kind: "connect", socket: 1 }, { kind: "hello", socket: 1, token: TOKEN }]);
  // An older connection's open says nothing.
  assert.deepEqual(step(r.model, { type: "open", socket: 7 }, 0).effects, []);
});

test("welcome makes it live and asks for the state at once", () => {
  const r = step(run([start, answered, { type: "open", socket: 1 }]).model, msg({ type: "welcome" }), 0);
  assert.equal(r.model.phase, "live");
  assert.deepEqual(r.effects, [{ kind: "welcomed", socket: 1 }]);
});

test("reconnect: 1, 2, 4, 8, then every 15 s, each on a new connection", () => {
  let m = live();
  const waits: number[] = [];
  let now = 0;
  for (let i = 0; i < 7; i++) {
    const closed = step(m, { type: "closed", socket: m.socket, code: 1006 }, now);
    assert.equal(closed.model.phase, "reconnecting");
    const wait = closed.effects.find((e) => e.kind === "retry_in");
    assert.ok(wait && wait.kind === "retry_in");
    waits.push(wait.ms);
    now += wait.ms;
    const retried = step(closed.model, { type: "retry" }, now);
    assert.deepEqual(retried.effects, [{ kind: "connect", socket: retried.model.socket }]);
    m = retried.model;
  }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 15_000, 15_000, 15_000]);
  assert.deepEqual(BACKOFF_MS, [1000, 2000, 4000, 8000, 15_000]);
});

test("a welcome after a reconnect starts the back-off again", () => {
  let m = step(live(), { type: "closed", socket: 1, code: 1006 }, 0).model;
  m = step(m, { type: "retry" }, 1000).model;
  m = step(m, msg({ type: "welcome" }, m.socket), 1100).model;
  assert.equal(m.phase, "live");
  assert.equal(m.attempt, 0);
  assert.equal(m.lostAt, null);
  const again = step(m, { type: "closed", socket: m.socket, code: 1006 }, 5000);
  assert.deepEqual(again.effects, [{ kind: "retry_in", ms: 1000 }]);
});

test("after 15 minutes without the server the session ends here; the token is forgotten", () => {
  let m = step(live(), { type: "closed", socket: 1, code: 1006 }, 0).model;
  let now = 0;
  for (;;) {
    const r = step(m, { type: "retry" }, now);
    const c = step(r.model, { type: "closed", socket: r.model.socket, code: 1006 }, now);
    m = c.model;
    if (m.phase !== "reconnecting") break;
    const wait = c.effects.find((e) => e.kind === "retry_in");
    now += wait && wait.kind === "retry_in" ? wait.ms : 0;
    assert.ok(now <= KEEP_MS);
  }
  assert.equal(m.phase, "ended");
  assert.equal(m.ended, "lost");
  assert.equal(m.session, null);
  assert.ok(!JSON.stringify(m).includes(TOKEN));
});

test("close codes: hello refused, ended, replaced end the session; any other reconnects", () => {
  for (const [code, reason] of [
    [CLOSE_HELLO_REFUSED, "gone"],
    [CLOSE_ENDED, "expired"],
    [CLOSE_REPLACED, "replaced"],
  ] as const) {
    const r = step(live(), { type: "closed", socket: 1, code }, 0);
    assert.equal(r.model.phase, "ended", String(code));
    assert.equal(r.model.ended, reason);
    assert.ok(!r.effects.some((e) => e.kind === "retry_in" || e.kind === "connect"));
  }
  for (const code of [1000, 1001, 1006, 1008, 1009, 1011]) assert.equal(step(live(), { type: "closed", socket: 1, code }, 0).model.phase, "reconnecting", String(code));
});

test("the server's ended closes the connection and forgets the token", () => {
  for (const [reason, why] of [
    ["host_ended", "host_ended"],
    ["revoked", "revoked"],
    ["expired", "expired"],
    ["dropped", "expired"],
  ] as const) {
    const r = step(live(), msg({ type: "ended", reason }), 0);
    assert.equal(r.model.ended, why);
    assert.deepEqual(r.effects, [{ kind: "close", socket: 1 }]);
    assert.equal(r.model.session, null);
  }
});

test("phones' places: joined, left (away), joined again; the joined phone gets the state at once", () => {
  let r = step(live(), msg({ type: "controller_joined", slot: 2, via: "code" }), 0);
  assert.deepEqual(r.model.places, ["none", "connected"]);
  assert.deepEqual(r.effects, [{ kind: "joined" }]);
  r = step(r.model, msg({ type: "controller_left", slot: 2, via: "code" }), 0);
  assert.deepEqual(r.model.places, ["none", "away"]);
  r = step(r.model, msg({ type: "controller_left", slot: 1, via: "sign_in" }), 0);
  assert.deepEqual(r.model.places, ["none", "away"]);
});

test("a control code only on request, live, with a second display; it is kept until cancelled", () => {
  assert.deepEqual(step(live(), { type: "make_code", secondDisplay: false }, 0).effects, []);
  assert.deepEqual(step(OFF, { type: "make_code", secondDisplay: true }, 0).effects, []);
  const asked = step(live(), { type: "make_code", secondDisplay: true }, 0);
  assert.deepEqual(asked.effects, [{ kind: "send", message: { v: 1, type: "make_code" } }]);
  let m = step(asked.model, msg({ type: "control_code", code: "QRST-VWXZ", expiresInMs: 120_000 }), 1000).model;
  assert.deepEqual(m.code, { code: "QRST-VWXZ", expiresAt: 121_000 });
  m = step(m, msg({ type: "code_cancelled", reason: "used" }), 2000).model;
  assert.equal(m.code, null);
  assert.equal(m.codeNote, "used");
});

test("Drop frees the place and ends the shown code; an empty place cannot be dropped", () => {
  let m = step(live(), msg({ type: "controller_joined", slot: 1, via: "code" }), 0).model;
  m = step(m, msg({ type: "control_code", code: "QRST-VWXZ", expiresInMs: 120_000 }), 0).model;
  const r = step(m, { type: "drop", slot: 1 }, 0);
  assert.deepEqual(r.effects, [{ kind: "send", message: { v: 1, type: "drop", slot: 1 } }]);
  assert.deepEqual(r.model.places, ["none", "none"]);
  assert.equal(r.model.code, null);
  assert.deepEqual(step(r.model, { type: "drop", slot: 2 }, 0).effects, []);
});

test("End while live hands the host's connection to the farewell (#211); while reconnecting it only closes the retry", () => {
  const ended = step(live(), { type: "end" }, 0);
  assert.deepEqual(ended.effects, [{ kind: "end_live", socket: 1, token: TOKEN }]);
  assert.equal(ended.model.phase, "ended");
  assert.equal(ended.model.socket, 0);
  assert.equal(ended.model.session, null);
  assert.ok(!JSON.stringify(ended.model).includes(TOKEN));
  const away = step(live(), { type: "closed", socket: 1, code: 1006 }, 0).model;
  const r = step(away, { type: "end" }, 0);
  assert.deepEqual(r.effects, [{ kind: "end_session", token: TOKEN }, { kind: "cancel_retry" }]);
  assert.equal(r.model.ended, "host_ended");
});

// #203: a session the host is not in is ended on the backend, never left there for 15 minutes.
test("End while starting cancels: the late answer's session is ended, nothing connects", () => {
  for (const ending of [{ type: "end" }, { type: "class_changed" }] as const) {
    const r = run([start, ending]);
    assert.equal(r.model.phase, "ended");
    assert.equal(r.model.ended, ending.type === "end" ? "host_ended" : "class_changed");
    const late = step(r.model, answered, 0);
    assert.deepEqual(late.effects, [{ kind: "end_session", token: TOKEN }]);
    assert.equal(late.model, r.model);
    assert.equal(late.model.session, null);
    // A late refusal has no session to end.
    assert.deepEqual(step(r.model, { type: "answer", request: 1, answer: { ok: false, refusal: "server" } }, 0).effects, []);
  }
});

test("an answer for an older start request is ended, the current one connects", () => {
  const r = run([start, { type: "end" }, start]);
  assert.equal(r.model.phase, "starting");
  assert.deepEqual(r.effects, [{ kind: "post_session", request: 1 }, { kind: "post_session", request: 2 }]);
  const old = step(r.model, answered, 0);
  assert.deepEqual(old.effects, [{ kind: "end_session", token: TOKEN }]);
  assert.equal(old.model.phase, "starting");
  const now = step(old.model, { ...answered, request: 2 }, 0);
  assert.equal(now.model.phase, "connecting");
  assert.deepEqual(now.effects, [{ kind: "connect", socket: 1 }]);
});

test("End or another class while connecting closes the connection and ends the session", () => {
  for (const before of [[start, answered], [start, answered, { type: "open", socket: 1 }]] as LiveEvent[][]) {
    for (const ending of [{ type: "end" }, { type: "class_changed" }] as const) {
      const r = step(run(before).model, ending, 0);
      assert.equal(r.model.phase, "ended");
      assert.equal(r.model.session, null);
      assert.deepEqual(r.effects, [{ kind: "end_session", token: TOKEN }, { kind: "close", socket: 1 }]);
    }
  }
});

test("another class while reconnecting ends the session; a session already gone is not ended again", () => {
  const away = step(live(), { type: "closed", socket: 1, code: 1006 }, 0).model;
  assert.deepEqual(step(away, { type: "class_changed" }, 0).effects, [{ kind: "end_session", token: TOKEN }, { kind: "cancel_retry" }]);
  for (const code of [CLOSE_HELLO_REFUSED, CLOSE_ENDED, CLOSE_REPLACED]) {
    assert.ok(!step(live(), { type: "closed", socket: 1, code }, 0).effects.some((e) => e.kind === "end_session"));
  }
  assert.ok(!step(live(), msg({ type: "ended", reason: "expired" }), 0).effects.some((e) => e.kind === "end_session"));
  assert.ok(!step(live(), { type: "end" }, 0).effects.some((e) => e.kind === "end_session"));
});

test("another class ends the run's session; a new one is only on request", () => {
  const r = step(live(), { type: "class_changed" }, 0);
  assert.equal(r.model.ended, "class_changed");
  assert.ok(!r.effects.some((e) => e.kind === "post_session" || e.kind === "connect"));
  assert.deepEqual(step(OFF, { type: "class_changed" }, 0).model, OFF);
});

test("an applied phone command is a line for 5 s, only while live", () => {
  const r = step(live(), { type: "applied", slot: 1, action: "pause", deltaMs: null }, 100);
  assert.deepEqual(r.model.line, { slot: 1, action: "pause", deltaMs: null, until: 5100 });
  assert.equal(step(OFF, { type: "applied", slot: 1, action: "pause", deltaMs: null }, 0).model.line, null);
});

test("events of an older connection change nothing", () => {
  const m = live();
  for (const e of [msg({ type: "ended", reason: "expired" }, 9), { type: "closed", socket: 9, code: 1006 } as const]) assert.deepEqual(step(m, e, 0), { model: m, effects: [] });
});

test("the session (and its join code) is set only by the start answer, never by a message", () => {
  const before = live();
  const messages: HostInbound[] = [
    { type: "control_code", code: "MNPQ-RSTV", expiresInMs: 120_000 },
    { type: "code_cancelled", reason: "used" },
    { type: "controller_joined", slot: 1, via: "code" },
    { type: "controller_left", slot: 1, via: "code" },
    { type: "welcome" },
  ];
  let m = before;
  for (const message of messages) {
    m = step(m, msg(message), 0).model;
    assert.equal(m.session, before.session, message.type);
  }
  assert.equal(m.session?.joinCode, "BCDF-GHJK");
});
