// `cancel_code` when only one display is left (ADR 0005 section 10, amended 2026-11-14; #353):
// the model drops a held control code and asks for `cancel_code`, or keeps it for right after the
// next `welcome` when the host is away; the live client sends exactly the contract's message on
// each trigger (the displays changing, the presenter's view, a code that comes while only one
// display is left) and, after a lost connection, as the first message after `welcome`. Fakes only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { HostInbound } from "../../src/core/live/host-wire.ts";
import { CANCEL_CODE } from "../../src/core/live/code-cancel.ts";
import { livePanelView } from "../../src/core/live/panel-view.ts";
import { step } from "../../src/core/live/session-model.ts";
import { OFF } from "../../src/core/live/session-types.ts";
import type { LiveEvent, LiveModel } from "../../src/core/live/session-types.ts";
import { CONTROL_CODE, HOST_TOKEN, ORIGIN, started } from "./live-relay.ts";
import type { Rig } from "./live-relay.ts";
import { liveSchema, RUN } from "./live-rig.ts";

const validCancelCode = new Ajv2020({ allErrors: true, strict: false }).compile(liveSchema("cancel-code"));
const SESSION = { sessionId: "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b", joinCode: "BCDF-GHJK", hostToken: HOST_TOKEN };
const CODE = { type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 } as const;

function run(events: readonly LiveEvent[], m: LiveModel = OFF): LiveModel {
  for (const e of events) m = step(m, e, 0).model;
  return m;
}
const msg = (message: HostInbound, socket = 1): LiveEvent => ({ type: "message", socket, message });
const live = (): LiveModel =>
  run([{ type: "start", run: RUN, credential: "ok", classOpen: true }, { type: "answer", request: 1, answer: { ok: true, session: SESSION } }, { type: "open", socket: 1 }, msg({ type: "welcome" })]);
const coded = (): LiveModel => run([msg(CODE)], live());

test("cancel_code is exactly the contract's message, and holds nothing", () => {
  assert.ok(validCancelCode(CANCEL_CODE), JSON.stringify(validCancelCode.errors));
  assert.deepEqual(Object.keys(CANCEL_CODE).sort(), ["type", "v"]);
});

test("live, one display left with a code held: the code goes at once and cancel_code is sent", () => {
  const r = step(coded(), { type: "one_display" }, 0);
  assert.equal(r.model.code, null);
  assert.equal(r.model.cancelPending, false);
  assert.deepEqual(r.effects, [{ kind: "send", message: { v: 1, type: "cancel_code" } }]);
  // The presenter then shows no code and offers none.
  const v = livePanelView(r.model, { now: 0, classOpen: true, secondDisplay: false, origin: ORIGIN });
  assert.deepEqual([v.controlCode, v.controlLink, v.canMakeCode, v.codeNote], [null, null, false, null]);
  // Only once: nothing more is held, so nothing more is sent.
  assert.deepEqual(step(r.model, { type: "one_display" }, 0).effects, []);
});

test("no code held: one display sends nothing and changes nothing", () => {
  for (const m of [OFF, live()]) {
    const r = step(m, { type: "one_display" }, 0);
    assert.equal(r.model, m);
    assert.deepEqual(r.effects, []);
  }
});

test("while reconnecting the cancel waits, then goes first after the next welcome, once", () => {
  const away = run([{ type: "closed", socket: 1, code: 1006 }], coded());
  assert.equal(away.phase, "reconnecting");
  const r = step(away, { type: "one_display" }, 0);
  assert.deepEqual(r.effects, []);
  assert.equal(r.model.code, null);
  assert.equal(r.model.cancelPending, true);
  const back = run([{ type: "retry" }, { type: "open", socket: 2 }], r.model);
  const w = step(back, msg({ type: "welcome" }, 2), 0);
  assert.deepEqual(w.effects, [{ kind: "welcomed", socket: 2, first: [{ v: 1, type: "cancel_code" }] }]);
  assert.equal(w.model.cancelPending, false);
  // The next welcome has nothing left to cancel.
  const again = run([{ type: "closed", socket: 2, code: 1006 }, { type: "retry" }, { type: "open", socket: 3 }], w.model);
  assert.deepEqual(step(again, msg({ type: "welcome" }, 3), 0).effects, [{ kind: "welcomed", socket: 3, first: [] }]);
});

test("a session that ends while the cancel waits forgets it: the server ended the code with it", () => {
  const waiting = step(run([{ type: "closed", socket: 1, code: 1006 }], coded()), { type: "one_display" }, 0).model;
  assert.equal(step(waiting, { type: "end" }, 0).model.cancelPending, false);
});

// The live client against the fake live process.

const sentOn = (r: Rig, type: string): unknown[] => r.socket().sent.filter((m) => (m as { type: string }).type === type);
async function withCode(): Promise<Rig> {
  const r = await started();
  r.live.makeCode();
  r.socket().server({ v: 1, ...CODE });
  assert.equal(r.live.view().controlCode, CONTROL_CODE);
  return r;
}

test("a display removed, one left: cancel_code goes out once and the code is gone", async () => {
  const r = await withCode();
  r.secondDisplay = false;
  r.live.displaysChanged();
  await r.advance(1000);
  assert.deepEqual(sentOn(r, "cancel_code"), [{ v: 1, type: "cancel_code" }]);
  assert.equal(r.live.view().controlCode, null);
  r.live.displaysChanged();
  r.live.tick();
  await r.advance(1000);
  assert.equal(sentOn(r, "cancel_code").length, 1);
});

test("with two displays nothing is cancelled", async () => {
  const r = await withCode();
  r.live.displaysChanged();
  r.live.tick();
  await r.advance(1000);
  assert.deepEqual(sentOn(r, "cancel_code"), []);
  assert.equal(r.live.view().controlCode, CONTROL_CODE);
});

test("the display count read without a display event (the presenter's view, a snapshot) cancels too", async () => {
  for (const look of [(r: Rig) => void r.live.view(), (r: Rig) => r.live.tick()]) {
    const r = await withCode();
    r.secondDisplay = false;
    look(r);
    await r.advance(1000);
    assert.deepEqual(sentOn(r, "cancel_code"), [{ v: 1, type: "cancel_code" }]);
  }
});

test("a code that comes after only one display is left is cancelled as it comes", async () => {
  const r = await started();
  r.live.makeCode();
  r.secondDisplay = false;
  r.socket().server({ v: 1, ...CODE });
  await r.advance(1000);
  assert.deepEqual(sentOn(r, "cancel_code"), [{ v: 1, type: "cancel_code" }]);
  assert.equal(r.live.view().controlCode, null);
});

test("one display while disconnected: cancel_code is the first message after the next welcome", async () => {
  const r = await withCode();
  const first = r.socket();
  first.drop(1006);
  r.secondDisplay = false;
  r.live.displaysChanged();
  assert.deepEqual(sentOn(r, "cancel_code"), []);
  await r.advance(1000);
  const next = r.socket();
  assert.notEqual(next, first);
  next.open();
  next.server({ v: 1, type: "welcome", role: "host" });
  await r.advance(1000);
  const types = next.sent.map((m) => (m as { type: string }).type);
  assert.deepEqual(types.slice(0, 2), ["hello", "cancel_code"]);
  assert.equal(types.filter((t) => t === "cancel_code").length, 1);
  assert.ok(validCancelCode(next.sent[1]));
  assert.ok(!JSON.stringify(next.sent[1]).includes(HOST_TOKEN));
});
