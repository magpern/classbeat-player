// The riders of the host's live session (core/live/riders-model.ts, riders-step.ts, riders-view.ts;
// ADR 0007 sections 2 to 4; riders-panel.md): the list in the order of `rider_joined`, the replay on
// a reconnect, and Remove, Lock joining and New code sending exactly the contract's messages. Pure:
// no clock but the one passed, no network.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import type { HostInbound } from "../../src/core/live/host-wire.ts";
import { HOUR_MS, MADE_MS, MAX_RIDERS, NEW_CODES_PER_HOUR } from "../../src/core/live/riders-model.ts";
import { RIDERS_EMPTY, ridersView } from "../../src/core/live/riders-view.ts";
import { step } from "../../src/core/live/session-model.ts";
import { OFF } from "../../src/core/live/session-types.ts";
import type { LiveEffect, LiveEvent, LiveModel } from "../../src/core/live/session-types.ts";
import { RUN } from "./live-rig.ts";

const TOKEN = `cbp_hst_${randomBytes(32).toString("base64url")}`;
const SESSION = { sessionId: "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b", joinCode: "BCDF-GHJK", hostToken: TOKEN };
const id = (n: number): string => `rider${String(n).padStart(6, "0")}`;

function run(events: readonly LiveEvent[], m: LiveModel = OFF, now = 0): { model: LiveModel; effects: LiveEffect[] } {
  const effects: LiveEffect[] = [];
  for (const e of events) {
    const out = step(m, e, now);
    m = out.model;
    effects.push(...out.effects);
  }
  return { model: m, effects };
}

const msg = (message: HostInbound, socket = 1): LiveEvent => ({ type: "message", socket, message });
const joined = (n: number, nickname: string, socket = 1): LiveEvent => msg({ type: "rider_joined", rider: id(n), nickname }, socket);
const left = (n: number, reason: "left" | "dropped" = "left", socket = 1): LiveEvent => msg({ type: "rider_left", rider: id(n), reason }, socket);
const live = (): LiveModel =>
  run([
    { type: "start", run: RUN, credential: "ok", classOpen: true },
    { type: "answer", request: 1, answer: { ok: true, session: SESSION } },
    { type: "open", socket: 1 },
    msg({ type: "welcome" }),
  ]).model;
const names = (m: LiveModel): string[] => m.riders.list.map((r) => r.nickname);
const sends = (effects: readonly LiveEffect[]): unknown[] => effects.flatMap((e) => (e.kind === "send" ? [e.message] : []));
const view = (m: LiveModel, now = 0) => ridersView(m, { now, classOpen: true });

test("the list is the riders in, in the order they joined; one who comes back goes to the end", () => {
  const m = run([joined(1, "Anna"), joined(2, "Bo"), joined(3, "Carlos"), left(2), joined(2, "Bo"), joined(1, "Anna")], live()).model;
  assert.deepEqual(names(m), ["Carlos", "Bo", "Anna"]);
  // Two riders with one nickname are two rows.
  assert.deepEqual(names(run([joined(4, "Anna")], m).model), ["Carlos", "Bo", "Anna", "Anna"]);
});

test("the list holds the server's id and the nickname only, never more than the cap", () => {
  let m = live();
  for (let n = 0; n < MAX_RIDERS + 3; n++) m = run([joined(n, `R${n}`)], m).model;
  assert.equal(m.riders.list.length, MAX_RIDERS);
  for (const r of m.riders.list) assert.deepEqual(Object.keys(r).sort(), ["id", "nickname"]);
  assert.equal(view(m).word, "Full");
  assert.equal(view(m).line, "The class is full. More riders cannot join.");
});

test("Remove sends drop_rider with the rider's id; the row goes only when rider_left comes", () => {
  const m = run([joined(1, "Anna"), joined(2, "Bo")], live()).model;
  const r = step(m, { type: "drop_rider", rider: id(2) }, 0);
  assert.deepEqual(sends(r.effects), [{ v: 1, type: "drop_rider", rider: id(2) }]);
  assert.deepEqual(names(r.model), ["Anna", "Bo"]);
  assert.deepEqual(names(run([left(2, "dropped")], r.model).model), ["Anna"]);
  // A rider not in the list sends nothing.
  assert.deepEqual(step(m, { type: "drop_rider", rider: id(9) }, 0).effects, []);
});

test("Lock sends lock with the value asked; the panel changes only when lock_state comes back", () => {
  const m = live();
  const r = step(m, { type: "lock", locked: true }, 0);
  assert.deepEqual(sends(r.effects), [{ v: 1, type: "lock", locked: true }]);
  assert.equal(view(r.model).lockText, "Lock joining");
  const locked = run([msg({ type: "lock_state", locked: true })], r.model).model;
  const v = view(locked);
  assert.deepEqual([v.lockText, v.lockSub, v.word, v.line], ["Unlock joining", "Joining is locked", "Locked", "Joining is locked. Riders already in stay."]);
  assert.deepEqual(sends(step(locked, { type: "lock", locked: false }, 0).effects), [{ v: 1, type: "lock", locked: false }]);
  assert.deepEqual([view(m).lockText, view(m).lockSub, view(m).word], ["Lock joining", "Joining is open", null]);
});

test("New code sends new_join_code, ends the shown control code at once, and shows the new code for 10 s", () => {
  const coded = run([msg({ type: "control_code", code: "MNPQ-RSTV", expiresInMs: 120_000 })], live()).model;
  const r = step(coded, { type: "new_join_code" }, 1000);
  assert.deepEqual(sends(r.effects), [{ v: 1, type: "new_join_code" }]);
  assert.equal(r.model.code, null);
  const made = run([msg({ type: "join_code", code: "KXPD-RMTB" })], r.model, 2000).model;
  assert.equal(made.session?.joinCode, "KXPD-RMTB");
  assert.equal(view(made, 2000).line, "New code KXPD-RMTB. The room screen shows it now.");
  assert.equal(view(made, 2000 + MADE_MS).line, null);
});

test("at most 10 new codes an hour: the 11th is not sent and the button says so until the oldest is an hour old", () => {
  let m = live();
  for (let i = 0; i < NEW_CODES_PER_HOUR; i++) {
    const r = step(m, { type: "new_join_code" }, i * 1000);
    assert.equal(sends(r.effects).length, 1);
    m = r.model;
  }
  assert.deepEqual(step(m, { type: "new_join_code" }, 20_000).effects, []);
  assert.deepEqual([view(m, 20_000).canNewCode, view(m, 20_000).newCodeSub], [false, "10 an hour, used up"]);
  assert.equal(view(m, HOUR_MS + 1).canNewCode, true);
  assert.equal(sends(step(m, { type: "new_join_code" }, HOUR_MS + 1).effects).length, 1);
});

test("a reconnect greys the list and turns every button off until the replay ends; the replay replaces the list", () => {
  const before = run([joined(1, "Anna"), joined(2, "Bo"), joined(3, "Carlos")], live()).model;
  const lost = run([{ type: "closed", socket: 1, code: 1006 }], before, 0).model;
  assert.equal(view(lost).dim, true);
  assert.equal(view(lost).word, "Reconnecting");
  assert.equal(view(lost).line, "Reconnecting. The list comes back when the connection does.");
  assert.deepEqual(names(lost), ["Anna", "Bo", "Carlos"]);
  const back = run([{ type: "retry" }, { type: "open", socket: 2 }, msg({ type: "welcome" }, 2), joined(3, "Carlos", 2), joined(1, "Anna", 2)], lost).model;
  // Still the last list seen, greyed, and nothing acts.
  assert.deepEqual(names(back), ["Anna", "Bo", "Carlos"]);
  assert.equal(view(back).active, false);
  for (const e of [{ type: "drop_rider", rider: id(1) }, { type: "lock", locked: true }, { type: "new_join_code" }] as const) assert.deepEqual(step(back, e, 0).effects, []);
  const settled = run([msg({ type: "lock_state", locked: true }, 2)], back).model;
  assert.deepEqual(names(settled), ["Carlos", "Anna"]);
  const v = view(settled);
  assert.deepEqual([v.active, v.dim, v.locked, v.lockText], [true, false, true, "Unlock joining"]);
  assert.deepEqual(sends(step(settled, { type: "lock", locked: false }, 0).effects), [{ v: 1, type: "lock", locked: false }]);
});

test("a socket lost before the first welcome: the next welcome is a first one, with no replay to wait for", () => {
  const before = run([
    { type: "start", run: RUN, credential: "ok", classOpen: true },
    { type: "answer", request: 1, answer: { ok: true, session: SESSION } },
    { type: "open", socket: 1 },
    { type: "closed", socket: 1, code: 1006 },
  ]).model;
  assert.equal(before.phase, "reconnecting");
  // No lock_state follows this welcome (the server had not attached the host before).
  const m = run([{ type: "retry" }, { type: "open", socket: 2 }, msg({ type: "welcome" }, 2), joined(1, "Anna", 2)], before).model;
  assert.equal(m.riders.replay, null);
  assert.deepEqual(names(m), ["Anna"]);
  const v = view(m);
  assert.deepEqual([v.active, v.dim, v.word, v.count], [true, false, null, "1"]);
  assert.deepEqual(sends(step(m, { type: "lock", locked: true }, 0).effects), [{ v: 1, type: "lock", locked: true }]);
  // A later reconnect, after this welcome, does wait for the replay.
  const again = run([{ type: "closed", socket: 2, code: 1006 }, { type: "retry" }, { type: "open", socket: 3 }, msg({ type: "welcome" }, 3)], m).model;
  assert.deepEqual(again.riders.replay, []);
  assert.equal(view(again).active, false);
});

test("the first welcome starts open with the list empty, and the panel acts at once", () => {
  const v = view(live());
  assert.deepEqual([v.on, v.active, v.count, v.locked, v.rows.length], [true, true, "0", false, 0]);
  assert.equal(RIDERS_EMPTY, "No riders yet. Riders scan the QR code on the room screen.");
});

test("the session ending clears the list; the panel goes back to Join codes are off", () => {
  const m = run([joined(1, "Anna")], live()).model;
  for (const e of [{ type: "end" }, { type: "class_changed" }] as const) {
    const after = step(m, e, 0).model;
    assert.deepEqual(after.riders.list, []);
    const v = view(after);
    assert.deepEqual([v.on, v.count, v.offLine, v.rows.length], [false, "–", "Join codes are off", 0]);
  }
  const ended = run([msg({ type: "ended", reason: "host_ended" })], m).model;
  assert.deepEqual(ended.riders.list, []);
});

test("join codes off: the count is a dash and Turn on join codes acts only with a class open", () => {
  const v = ridersView(OFF, { now: 0, classOpen: true });
  assert.deepEqual([v.shown, v.on, v.count, v.canTurnOn, v.offLine, v.active], [true, false, "–", true, "Join codes are off", false]);
  assert.equal(ridersView(OFF, { now: 0, classOpen: false }).canTurnOn, false);
  const starting = run([{ type: "start", run: RUN, credential: "ok", classOpen: true }]).model;
  assert.deepEqual([view(starting).offLine, view(starting).canTurnOn], ["Turning on join codes", false]);
});

test("rows are text and an id only: no number, no time, no order but the join order", () => {
  const m = run([joined(2, "Zed"), joined(1, "<b>Al</b>"), joined(3, ".")], live()).model;
  const v = view(m);
  assert.deepEqual(v.rows, [{ id: id(2), nickname: "Zed" }, { id: id(1), nickname: "<b>Al</b>" }, { id: id(3), nickname: "." }]);
  for (const r of v.rows) assert.deepEqual(Object.keys(r).sort(), ["id", "nickname"]);
});

test("rider messages of an older connection are not taken", () => {
  const m = live();
  assert.deepEqual(run([joined(1, "Anna", 7)], m).model.riders, m.riders);
});
