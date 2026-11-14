// A `cancel_code` or `drop` still in the send budget's queue when the host's connection is lost
// (#381; ADR 0005 sections 3 and 10): the queue goes with the connection, but those two are kept
// and go first after the next `welcome` (core/live/held-over.ts), `cancel_code` ahead of the
// drops, each once. Nothing else of the lost queue is sent again. The pure rule, then the live
// client over the fake live process with its send budget spent. Fakes only, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { CANCEL_CODE } from "../../src/core/live/code-cancel.ts";
import { heldOver, keptOnLoss, welcomedFirst } from "../../src/core/live/held-over.ts";
import type { HostInbound } from "../../src/core/live/host-wire.ts";
import { MAX_PER_WINDOW } from "../../src/core/live/send-budget.ts";
import { KEEP_MS, step } from "../../src/core/live/session-model.ts";
import { OFF } from "../../src/core/live/session-types.ts";
import type { LiveEvent, LiveModel } from "../../src/core/live/session-types.ts";
import { CONTROL_CODE, HOST_TOKEN, started } from "./live-relay.ts";
import type { Rig } from "./live-relay.ts";
import { liveSchema, RUN } from "./live-rig.ts";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validCancelCode = ajv.compile(liveSchema("cancel-code"));
const validDrop = ajv.compile(liveSchema("drop"));
const SESSION = { sessionId: "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b", joinCode: "BCDF-GHJK", hostToken: HOST_TOKEN };
const DROP_1 = { v: 1, type: "drop", slot: 1 } as const;
const DROP_2 = { v: 1, type: "drop", slot: 2 } as const;

function run(events: readonly LiveEvent[], m: LiveModel = OFF): LiveModel {
  for (const e of events) m = step(m, e, 0).model;
  return m;
}
const msg = (message: HostInbound, socket = 1): LiveEvent => ({ type: "message", socket, message });
const live = (): LiveModel =>
  run([
    { type: "start", run: RUN, credential: "ok", classOpen: true },
    { type: "answer", request: 1, answer: { ok: true, session: SESSION } },
    { type: "open", socket: 1 },
    msg({ type: "welcome" }),
    msg({ type: "controller_joined", slot: 1, via: "code" }),
    msg({ type: "controller_joined", slot: 2, via: "sign_in" }),
  ]);

test("of a lost queue only cancel_code and drop are kept, in the queue's order", () => {
  const queue = [
    { v: 1, type: "command_result", id: "x", outcome: "applied" },
    DROP_2,
    { v: 1, type: "make_code" },
    CANCEL_CODE,
    { v: 1, type: "lock", locked: true },
    { v: 1, type: "new_join_code" },
    { v: 1, type: "drop_rider", rider: "r" },
    { v: 1, type: "end" },
    DROP_1,
  ];
  assert.deepEqual(heldOver(queue), [DROP_2, CANCEL_CODE, DROP_1]);
  assert.deepEqual(heldOver([]), []);
});

test("the model: a lost cancel_code and drop go first after the next welcome, cancel_code ahead, each once", () => {
  // Drop pressed on place 2, then place 1 (sent, both waiting); the queue lost with both and a cancel.
  const pressed = run([{ type: "drop", slot: 2 }, { type: "drop", slot: 1 }], live());
  const away = step(pressed, { type: "closed", socket: 1, code: 1006, unsent: [DROP_2, CANCEL_CODE, DROP_1] }, 0).model;
  assert.equal(away.phase, "reconnecting");
  assert.equal(away.cancelPending, true);
  assert.deepEqual(away.drops, ["queued", "queued"]);
  const back = run([{ type: "retry" }, { type: "open", socket: 2 }], away);
  const w = step(back, msg({ type: "welcome" }, 2), 0);
  assert.deepEqual(w.effects, [{ kind: "welcomed", socket: 2, first: [CANCEL_CODE, DROP_1, DROP_2] }]);
  assert.equal(w.model.cancelPending, false);
  // Sent again: each waits for its answer as any drop does (live-drop-once.test.ts).
  assert.deepEqual(w.model.drops, ["sent", "sent"]);
  // The next welcome has nothing left to send first.
  const again = run([{ type: "closed", socket: 2, code: 1006 }, { type: "retry" }, { type: "open", socket: 3 }], w.model);
  assert.deepEqual(step(again, msg({ type: "welcome" }, 3), 0).effects, [{ kind: "welcomed", socket: 3, first: [] }]);
});

test("a drop that went out before the loss is not sent again: the replay answers it", () => {
  const pressed = step(live(), { type: "drop", slot: 1 }, 0).model;
  const away = step(pressed, { type: "closed", socket: 1, code: 1006, unsent: [] }, 0).model;
  assert.deepEqual(away.drops, ["sent", "none"]);
  const back = run([{ type: "retry" }, { type: "open", socket: 2 }], away);
  const w = step(back, msg({ type: "welcome" }, 2), 0);
  assert.deepEqual(w.effects, [{ kind: "welcomed", socket: 2, first: [] }]);
  assert.deepEqual(w.model.drops, ["none", "none"]);
});

test("a lost connection that ends the session keeps nothing: the server ended the code and places with it", () => {
  const pressed = step(live(), { type: "drop", slot: 1 }, 0).model;
  for (const code of [4401, 4403, 4409]) {
    const gone = step(pressed, { type: "closed", socket: 1, code, unsent: [CANCEL_CODE, DROP_1] }, 0).model;
    assert.equal(gone.phase, "ended");
    assert.equal(gone.cancelPending, false);
    assert.deepEqual(gone.drops, ["none", "none"]);
  }
  // Away for longer than the live process keeps the session: it ends here with nothing kept.
  const retrying = run([{ type: "closed", socket: 1, code: 1006, unsent: [] }, { type: "retry" }], pressed);
  assert.equal(retrying.socket, 2);
  const late = step(retrying, { type: "closed", socket: 2, code: 1006, unsent: [CANCEL_CODE, DROP_1] }, KEEP_MS);
  assert.equal(late.model.phase, "ended");
  assert.equal(late.model.ended, "lost");
  assert.equal(late.model.cancelPending, false);
  assert.deepEqual(late.model.drops, ["none", "none"]);
});

test("keptOnLoss and welcomedFirst leave the model they are given unchanged", () => {
  const m = live();
  const before = JSON.stringify(m);
  const kept = keptOnLoss(m, [CANCEL_CODE, DROP_2]);
  welcomedFirst(kept);
  assert.equal(JSON.stringify(m), before);
});

// The live client against the fake live process, with the send budget spent.

const types = (sent: unknown[]): string[] => sent.map((m) => (m as { type: string }).type);
/** Fills the send budget's window until a press waits in its queue (make_code needs no answer here). */
function spend(r: Rig): void {
  for (let i = 0; i < MAX_PER_WINDOW; i += 1) r.live.makeCode();
  assert.ok(types(r.socket().sent).filter((t) => t === "make_code").length < MAX_PER_WINDOW, "the window is full");
}
async function reconnect(r: Rig): Promise<Rig["sockets"][number]> {
  const first = r.socket();
  first.drop(1006);
  await r.advance(1000);
  const next = r.socket();
  assert.notEqual(next, first);
  next.open();
  next.server({ v: 1, type: "welcome", role: "host" });
  return next;
}

test("budget spent, cancel_code queued, connection lost: on the next welcome cancel_code goes out first", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  spend(r);
  r.secondDisplay = false;
  r.live.displaysChanged();
  assert.equal(r.live.view().controlCode, null, "the code goes from the presenter at once");
  assert.ok(!types(r.socket().sent).includes("cancel_code"), "queued: the window is full");
  const next = await reconnect(r);
  await r.advance(1000);
  assert.deepEqual(types(next.sent).slice(0, 2), ["hello", "cancel_code"]);
  assert.equal(types(next.sent).filter((t) => t === "cancel_code").length, 1);
  assert.ok(validCancelCode(next.sent[1]), JSON.stringify(validCancelCode.errors));
  // The make_code presses lost with the queue are not sent again.
  assert.ok(!types(next.sent).includes("make_code"));
});

test("budget spent, drop queued, connection lost: on the next welcome the drop goes out first", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  spend(r);
  r.live.drop(1);
  assert.ok(!types(r.socket().sent).includes("drop"), "queued: the window is full");
  const next = await reconnect(r);
  await r.advance(1000);
  assert.deepEqual(next.sent.slice(0, 2), [{ v: 1, type: "hello", token: HOST_TOKEN }, DROP_1]);
  assert.equal(types(next.sent).filter((t) => t === "drop").length, 1);
  assert.ok(validDrop(next.sent[1]), JSON.stringify(validDrop.errors));
  // Until the server answers it, the place takes no other drop, even when the replay shows it held.
  next.server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  assert.deepEqual(r.live.view().slots[0], { slot: 1, text: "Phone 1: dropping", canDrop: false });
  r.live.drop(1);
  assert.equal(types(next.sent).filter((t) => t === "drop").length, 1);
  next.server({ v: 1, type: "controller_left", slot: 1, via: "code", reason: "dropped" });
  assert.deepEqual(r.live.view().slots[0], { slot: 1, text: "Phone 1: free", canDrop: false });
});

test("both queued: cancel_code first, then the drop, and nothing of either before the welcome", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "controller_joined", slot: 2, via: "sign_in" });
  r.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  spend(r);
  // The cancel first: a drop ends the shown code itself, so it would leave nothing to cancel.
  r.secondDisplay = false;
  r.live.displaysChanged();
  r.live.drop(2);
  const first = r.socket();
  first.drop(1006);
  await r.advance(500);
  assert.ok(!types(first.sent).includes("drop") && !types(first.sent).includes("cancel_code"));
  await r.advance(500);
  r.socket().open();
  assert.deepEqual(types(r.socket().sent), ["hello"], "nothing before the welcome");
  r.socket().server({ v: 1, type: "welcome", role: "host" });
  assert.deepEqual(r.socket().sent.slice(1, 3), [CANCEL_CODE, DROP_2]);
});
