// The run's publisher once its last message is queued (#216; src/main/live/publisher.ts): after
// `last`, nothing but `end` goes out, a phone's command is not applied, and `queue`, `command`,
// `joined` and `tick` do nothing at all, not even a read of the class or a new timer. Directly
// against createPublisher, with a fixed class, a fake clock and fake timers. Fakes only: no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandResult } from "../../../../schema/generated/ts/live-command-result.d.ts";
import { createPublisher } from "../../src/main/live/publisher.ts";
import type { Publisher } from "../../src/main/live/publisher.ts";
import { MAX_PER_WINDOW, WINDOW_MS } from "../../src/core/live/send-budget.ts";
import { following, forwarded, id, loaded, NOW, RUN } from "./live-rig.ts";

const END = { v: 1, type: "end" } as const;
const result = (n: number): CommandResult => ({ v: 1, type: "command_result", slot: 1, id: id(n), result: "applied", reason: null });

interface Bench {
  readonly p: Publisher;
  readonly sent: { type: string }[];
  /** Commands applied to the class, reads of it and timers set. */
  readonly count: { applied: number; reads: number; timers: number };
  /** Moves the clock on, running every timer that falls due. */
  advance(ms: number): void;
  /** The class as the next read sees it. */
  state: ReturnType<typeof loaded>;
}

function bench(): Bench {
  let now = NOW;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const count = { applied: 0, reads: 0, timers: 0 };
  const sent: { type: string }[] = [];
  const b: Bench = {
    sent,
    count,
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
    p: null as unknown as Publisher,
  };
  (b as { p: Publisher }).p = createPublisher({
    run: RUN,
    host: {
      read: () => {
        count.reads += 1;
        return { state: b.state, now, canSend: true };
      },
      apply: () => void (count.applied += 1),
    },
    setTimer: (fn, ms) => {
      count.timers += 1;
      ids += 1;
      timers.push({ at: now + ms, fn, id: ids });
      return ids;
    },
    clearTimer: (h) => void (timers = timers.filter((t) => t.id !== h)),
    applied: () => undefined,
  });
  b.p.connected((text) => void sent.push(JSON.parse(text) as { type: string }));
  return b;
}

test("after last, queue, command, joined and tick do nothing, and only end goes out", () => {
  const b = bench();
  // On connect: the state, then the riders' state (rider-send.ts), both due at once.
  assert.deepEqual(b.sent.map((m) => m.type), ["companion_state", "rider_state"]);
  // A command before the end is taken: the same command after it would be too, but for the end.
  b.p.command(forwarded("pause", { id: id(1) }));
  assert.equal(b.count.applied, 1);
  // The rest of the second's budget, so the end has to wait.
  while (b.sent.length < MAX_PER_WINDOW) b.p.queue(result(100 + b.sent.length));
  let told = 0;
  assert.equal(
    b.p.last(END, () => void (told += 1)),
    true,
  );
  assert.equal(b.sent.length, MAX_PER_WINDOW);
  const reads = b.count.reads;
  const timers = b.count.timers;
  b.p.queue(result(200));
  b.p.command(forwarded("pause", { id: id(2) }));
  b.p.joined();
  b.state = loaded(following("Locked"), "paused");
  b.p.tick();
  // Nothing was taken: no command applied, the class not read, no new timer.
  assert.equal(b.count.applied, 1);
  assert.equal(b.count.reads, reads);
  assert.equal(b.count.timers, timers);
  assert.equal(b.p.last(END, () => undefined), false);
  b.advance(WINDOW_MS);
  assert.deepEqual(b.sent.slice(MAX_PER_WINDOW), [END]);
  assert.equal(told, 1);
  // Nothing after the end, ever.
  b.p.queue(result(300));
  b.p.tick();
  b.advance(10 * WINDOW_MS);
  assert.equal(b.sent.length, MAX_PER_WINDOW + 1);
  assert.equal(told, 1);
});

test("last on a publisher with no connection queues nothing, tells nobody and sends nothing, now or after a reconnect (#212 N1)", () => {
  const b = bench();
  b.p.disconnected();
  let told = 0;
  assert.equal(b.p.last(END, () => void (told += 1)), false);
  b.p.connected((text) => void b.sent.push(JSON.parse(text) as { type: string }));
  // Exactly what the reconnect sent on its own: one more state, and no end.
  assert.deepEqual(b.sent.map((m) => m.type), ["companion_state", "rider_state", "companion_state", "rider_state"]);
  b.advance(10 * WINDOW_MS);
  assert.equal(b.sent.filter((m) => m.type === "end").length, 0);
  assert.equal(told, 0);
  b.p.stop();
  assert.equal(b.p.last(END, () => void (told += 1)), false);
  assert.equal(told, 0);
});

test("a second last is refused: its callback is never told and only one end goes out (#212 N1)", () => {
  const b = bench();
  let first = 0;
  let second = 0;
  // The second's budget is spent, so the first end is still waiting (the budget is not cleared)
  // when the second `last` comes: only the `lastSent !== null` guard can refuse it.
  while (b.sent.length < MAX_PER_WINDOW) b.p.queue(result(100 + b.sent.length));
  assert.equal(b.p.last(END, () => void (first += 1)), true);
  assert.equal(b.sent.length, MAX_PER_WINDOW);
  assert.equal(b.p.last(END, () => void (second += 1)), false);
  b.advance(10 * WINDOW_MS);
  assert.equal(b.sent.filter((m) => m.type === "end").length, 1);
  assert.equal(first, 1);
  assert.equal(second, 0);
});

test("a stop from within a send ends the pump: nothing more goes out and no timer is set", () => {
  let timers = 0;
  const p = createPublisher({
    run: RUN,
    host: { read: () => ({ state: loaded(following("Locked")), now: NOW, canSend: true }), apply: () => undefined },
    setTimer: () => void (timers += 1),
    clearTimer: () => undefined,
    applied: () => undefined,
  });
  // A transport that answers within send, and the answer ends the run.
  const out: string[] = [];
  p.connected((text) => {
    out.push((JSON.parse(text) as { type: string }).type);
    p.stop();
  });
  assert.deepEqual(out, ["companion_state"]);
  assert.equal(timers, 0);
});

test("a sender replaced from within its own send sends nothing more: its late sends are dropped (#217 N1)", () => {
  const b = bench();
  const old: string[] = [];
  const fresh: string[] = [];
  const type = (text: string): string => (JSON.parse(text) as { type: string }).type;
  // The old connection: on the first message of a backlog it is replaced by a new one, within send.
  b.p.connected((text) => {
    old.push(type(text));
    if (old.length === MAX_PER_WINDOW + 1) {
      b.p.disconnected();
      b.p.connected((t) => void fresh.push(type(t)));
    }
  });
  // Fill this second's budget, then a backlog that falls due all at once in the next one.
  while (old.length < MAX_PER_WINDOW) b.p.queue(result(100 + old.length));
  for (let i = 0; i < 3; i++) b.p.queue(result(200 + i));
  assert.equal(old.length, MAX_PER_WINDOW);
  b.advance(WINDOW_MS);
  // The old sender got the one message it was sending when it was replaced, and nothing after it.
  assert.equal(old.length, MAX_PER_WINDOW + 1);
  // The new connection starts fresh: the state, and none of the old queue.
  assert.deepEqual(fresh, ["companion_state", "rider_state"]);
  b.advance(10 * WINDOW_MS);
  assert.equal(old.length, MAX_PER_WINDOW + 1);
});
