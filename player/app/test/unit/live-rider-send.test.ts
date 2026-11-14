// The host's rider_state on its live connection (core/live/rider-send.ts, main/live/publisher.ts;
// ADR 0007 section 8, items 5 and 8): every one published is exactly `riderStateOf` of the class
// at that moment, under its policy (at once on a change of status or interval, else every 2 s, at
// most 2 in any second), in the room the send budget leaves (under 8 messages a second in all).
// Against createPublisher with a fixed class, a fake clock and fake timers. Fakes only: no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandResult } from "../../../../schema/generated/ts/live-command-result.d.ts";
import { newRiderSender, riderInputOf, riderReconnected, riderTake } from "../../src/core/live/rider-send.ts";
import { RIDER_HEARTBEAT_MS, RIDER_MAX_PER_WINDOW, RIDER_WINDOW_MS } from "../../src/core/live/rider-policy.ts";
import { riderStateOf } from "../../src/core/live/rider-state.ts";
import { MAX_PER_WINDOW, newBudget, spent, WINDOW_MS } from "../../src/core/live/send-budget.ts";
import type { PlayerState } from "../../src/core/player-state.ts";
import { createPublisher } from "../../src/main/live/publisher.ts";
import type { Publisher } from "../../src/main/live/publisher.ts";
import { Ajv2020 } from "ajv/dist/2020.js";
import { following, id, liveSchema, loaded, NOW, RUN } from "./live-rig.ts";

const validRiderState = new Ajv2020({ allErrors: true, strict: false }).compile(liveSchema("rider-state"));
const END = { v: 1, type: "end" } as const;
const result = (n: number): CommandResult => ({ v: 1, type: "command_result", slot: 1, id: id(n), result: "applied", reason: null });

interface Sent {
  readonly at: number;
  readonly m: { type: string; seq?: number } & Record<string, unknown>;
  /** The class as the publisher read it when this went out. */
  readonly state: PlayerState;
}

interface Bench {
  readonly p: Publisher;
  readonly sent: Sent[];
  now(): number;
  advance(ms: number): void;
  state: PlayerState;
  connect(): void;
}

function bench(): Bench {
  let now = NOW;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const sent: Sent[] = [];
  const b: Bench = {
    sent,
    now: () => now,
    state: loaded(following("Locked")),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((x, y) => x.at - y.at || x.id - y.id);
        const next = timers[0];
        if (next === undefined || next.at > end) break;
        timers = timers.slice(1);
        now = Math.max(now, next.at);
        next.fn();
      }
      now = end;
    },
    connect: () => b.p.connected((text) => void sent.push({ at: now, m: JSON.parse(text) as Sent["m"], state: b.state })),
    p: null as unknown as Publisher,
  };
  (b as { p: Publisher }).p = createPublisher({
    run: RUN,
    host: { read: () => ({ state: b.state, now, canSend: true }), apply: () => undefined },
    setTimer: (fn, ms) => {
      ids += 1;
      timers.push({ at: now + ms, fn, id: ids });
      return ids;
    },
    clearTimer: (h) => void (timers = timers.filter((t) => t.id !== h)),
    applied: () => undefined,
  });
  b.connect();
  return b;
}

const riders = (b: Bench): Sent[] => b.sent.filter((s) => s.m.type === "rider_state");

/** Each rider_state is exactly the builder's, for the class at the moment it was sent. */
function exact(list: readonly Sent[]): void {
  for (const s of list) {
    const input = riderInputOf(s.state, s.at, true);
    assert.ok(input !== null);
    assert.deepEqual(s.m, riderStateOf(input, RUN, s.m.seq as number));
    assert.ok(validRiderState(s.m), JSON.stringify(validRiderState.errors));
  }
}

function inAnySecond(list: readonly Sent[], cap: number): void {
  for (const a of list) {
    const n = list.filter((s) => s.at > a.at - WINDOW_MS && s.at <= a.at).length;
    assert.ok(n <= cap, `${n} in a second at ${a.at}`);
  }
}

test("the first rider_state goes at once with the state, then one every 2 s while nothing changes", () => {
  const b = bench();
  assert.deepEqual(b.sent.map((s) => s.m.type), ["companion_state", "rider_state"]);
  for (let i = 0; i < 100; i++) {
    b.advance(100);
    b.p.tick();
  }
  const r = riders(b);
  exact(r);
  assert.deepEqual(r.map((s) => s.m.seq), r.map((_, i) => i));
  for (let i = 1; i < r.length; i++) assert.equal(r[i].at - r[i - 1].at, RIDER_HEARTBEAT_MS);
  assert.equal(r.length, 6);
});

test("a change of status goes at once, and a change of interval as well", () => {
  const b = bench();
  b.advance(500);
  b.state = loaded(following("Locked"), "paused");
  b.p.tick();
  const paused = riders(b).at(-1);
  assert.equal(paused?.at, NOW + 500);
  assert.equal(paused?.m.status, "paused");
  // The class moved on to its next interval: the clock anchored past the first interval's end.
  const input = riderInputOf(b.state, b.now(), true);
  assert.ok(input !== null);
  const firstEnd = input.doc.intervals[0].start_ms + input.doc.intervals[0].length_ms;
  b.advance(700);
  b.state = loaded(following("Locked"), "paused", firstEnd * 1000 + 1000);
  b.p.tick();
  const moved = riders(b).at(-1);
  assert.equal(moved?.at, NOW + 1200);
  assert.notEqual((moved?.m.now as { index: number }).index, (paused?.m.now as { index: number }).index);
  exact(riders(b));
});

test("however often the class changes, at most 2 rider_states in any second and under 8 messages in all", () => {
  const b = bench();
  const statuses = ["running", "paused"] as const;
  for (let i = 0; i < 60; i++) {
    b.state = loaded(following("Locked"), statuses[i % 2], 60_000 + i * 50);
    b.p.tick();
    if (i % 3 === 0) b.p.queue(result(i));
    b.advance(50);
  }
  b.advance(5 * WINDOW_MS);
  const r = riders(b);
  assert.ok(r.length >= 4);
  inAnySecond(r, RIDER_MAX_PER_WINDOW);
  inAnySecond(b.sent, MAX_PER_WINDOW);
  exact(r);
  // The last change is published: the riders end on the class as it is.
  assert.equal(r.at(-1)?.m.status, b.state.loaded?.clock.status === "paused" ? "paused" : "running");
});

test("rider_state only takes the room left: a full second of results holds it back, never the results", () => {
  const b = bench();
  while (b.sent.length < MAX_PER_WINDOW) b.p.queue(result(100 + b.sent.length));
  b.state = loaded(following("Locked"), "paused");
  b.p.queue(result(200));
  b.p.tick();
  assert.equal(b.sent.length, MAX_PER_WINDOW);
  b.advance(WINDOW_MS);
  const types = b.sent.slice(MAX_PER_WINDOW).map((s) => s.m.type);
  assert.equal(types[0], "command_result");
  assert.ok(types.includes("rider_state"));
  inAnySecond(b.sent, MAX_PER_WINDOW);
});

test("nothing after the run's end, not a rider_state either", () => {
  const b = bench();
  b.p.last(END, () => undefined);
  const n = b.sent.length;
  assert.equal(b.sent.at(-1)?.m.type, "end");
  b.state = loaded(following("Locked"), "paused");
  b.p.tick();
  b.advance(10 * WINDOW_MS);
  assert.equal(b.sent.length, n);
});

test("a new connection gets a rider_state at once; the run's numbers go on", () => {
  const b = bench();
  b.advance(2500);
  b.p.disconnected();
  const before = riders(b).length;
  b.advance(10_000);
  assert.equal(riders(b).length, before);
  b.connect();
  const r = riders(b);
  assert.equal(r.length, before + 1);
  assert.equal(r.at(-1)?.at, b.now());
  assert.equal(r.at(-1)?.m.seq, before);
});

test("riderTake: nothing without a class; exactly the builder's state when due and there is room", () => {
  const input = riderInputOf(loaded(following("Locked")), NOW, true);
  assert.ok(input !== null);
  assert.equal(riderTake(newRiderSender(), newBudget(), null, RUN, NOW).message, null);
  const t = riderTake(newRiderSender(), newBudget(), input, RUN, NOW);
  assert.deepEqual(t.message, riderStateOf(input, RUN, 0));
  assert.equal(t.sender.seq, 1);
  assert.equal(t.wakeAt, NOW + RIDER_HEARTBEAT_MS);
  // Not due again yet.
  assert.equal(riderTake(t.sender, t.budget, input, RUN, NOW + 1).message, null);
  // A full budget holds it back until there is room.
  let full = newBudget();
  for (let i = 0; i < MAX_PER_WINDOW; i++) full = spent(full, NOW);
  const held = riderTake(newRiderSender(), full, input, RUN, NOW);
  assert.equal(held.message, null);
  assert.equal(held.wakeAt, NOW + WINDOW_MS);
  // A reconnect makes the next one due at once and keeps the count.
  const again = riderTake(riderReconnected(t.sender), newBudget(), input, RUN, NOW + 1);
  assert.equal(again.message?.seq, 1);
  assert.equal(RIDER_WINDOW_MS, WINDOW_MS);
});
