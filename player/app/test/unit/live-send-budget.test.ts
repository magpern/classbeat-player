// The host's send budget (issue #172, ADR 0005 section 5): companion_state coalesced to at most 4
// a second, at least once a second and at once on controller_joined; command_results first; fewer
// than 8 messages in any second. Pure; a simulated clock.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandResult } from "../../../../schema/generated/ts/live-command-result.d.ts";
import { controllerJoined, enqueue, HEARTBEAT_MS, newBudget, STATE_GAP_MS, stateChanged, take, wakeAt } from "../../src/core/live/send-budget.ts";
import type { Send, SendBudget } from "../../src/core/live/send-budget.ts";
import { id } from "./live-rig.ts";

const result = (n: number): CommandResult => ({ v: 1, type: "command_result", slot: 1, id: id(n), result: "applied", reason: null });

interface Log {
  readonly at: number;
  readonly send: Send;
}

/** Runs the budget from 0 to `until`, calling `events` each millisecond, sending whatever is due. */
function run(until: number, events: (t: number, b: SendBudget) => SendBudget): Log[] {
  let b = newBudget();
  const log: Log[] = [];
  for (let t = 0; t <= until; t++) {
    b = events(t, b);
    const r = take(b, t);
    b = r.budget;
    for (const send of r.sends) log.push({ at: t, send });
  }
  return log;
}

function maxInAnySecond(log: readonly Log[], keep: (s: Send) => boolean): number {
  const at = log.filter((l) => keep(l.send)).map((l) => l.at);
  return Math.max(0, ...at.map((t) => at.filter((u) => u >= t && u < t + 1000).length));
}

test("the first state goes at once; then, unchanged, once a second", () => {
  const log = run(3500, (_t, b) => b);
  assert.deepEqual(
    log.map((l) => l.at),
    [0, 1000, 2000, 3000],
  );
});

test("changes are coalesced: at most 4 states a second, 250 ms apart, the latest state each time", () => {
  const log = run(5000, (_t, b) => stateChanged(b));
  assert.equal(maxInAnySecond(log, (s) => s.kind === "state"), 4);
  const at = log.map((l) => l.at);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= STATE_GAP_MS);
});

test("a controller joining gets a state at once, within the 4 a second", () => {
  const log = run(3000, (t, b) => (t === 1500 || t === 1510 ? controllerJoined(b) : b));
  assert.ok(log.some((l) => l.at === 1500 && l.send.kind === "state"));
  assert.ok(log.some((l) => l.at === 1510 && l.send.kind === "state"));
  assert.ok(maxInAnySecond(log, (s) => s.kind === "state") <= 4);
});

test("controllers joining over and over still get at most 4 states a second", () => {
  const log = run(5000, (t, b) => (t % 50 === 0 ? controllerJoined(b) : b));
  assert.equal(maxInAnySecond(log, (s) => s.kind === "state"), 4);
});

test("command_results go first, before other queued messages and the state", () => {
  let b = enqueue(newBudget(), { v: 1, type: "make_code" });
  b = enqueue(b, result(1));
  b = enqueue(b, result(2));
  const r = take(b, 0);
  assert.deepEqual(
    r.sends.map((s) => (s.kind === "state" ? "state" : s.message.type === "command_result" ? s.message.id : s.message.type)),
    [id(1), id(2), "make_code", "state"],
  );
});

test("under a flood of changes and commands, fewer than 8 messages in any second, results never lost", () => {
  let n = 0;
  const log = run(10_000, (t, b) => {
    let x = stateChanged(b);
    // Two controllers at the server's limit: 4 commands a second, plus bursts of host messages.
    if (t % 250 === 0) x = enqueue(x, result(n++));
    if (t % 1000 === 500) x = enqueue(enqueue(x, { v: 1, type: "make_code" }), { v: 1, type: "drop", slot: 2 });
    return x;
  });
  assert.ok(maxInAnySecond(log, () => true) <= 7, `${maxInAnySecond(log, () => true)}`);
  assert.ok(maxInAnySecond(log, (s) => s.kind === "state") <= 4);
  const results = log.filter((l) => l.send.kind === "message" && l.send.message.type === "command_result");
  assert.equal(results.length, n);
  // States still go at least once a second.
  const states = log.filter((l) => l.send.kind === "state").map((l) => l.at);
  for (let i = 1; i < states.length; i++) assert.ok(states[i] - states[i - 1] <= HEARTBEAT_MS, `${states[i - 1]} to ${states[i]}`);
});

test("a burst beyond the window waits, and wakeAt says when to send it", () => {
  let b = newBudget();
  for (let i = 0; i < 10; i++) b = enqueue(b, result(i));
  const first = take(b, 0);
  assert.equal(first.sends.length, 7);
  assert.equal(wakeAt(first.budget, 1), 1000);
  assert.equal(take(first.budget, 999).sends.length, 0);
  assert.equal(take(first.budget, 1000).sends.length, 4, "3 results and the first state");
});

test("wakeAt: the next heartbeat when nothing changed, the gap after a change", () => {
  const b = take(newBudget(), 0).budget;
  assert.equal(wakeAt(b, 10), HEARTBEAT_MS);
  assert.equal(wakeAt(stateChanged(b), 10), STATE_GAP_MS);
  assert.equal(wakeAt(controllerJoined(b), 10), 10);
});
