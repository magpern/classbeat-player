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
  assert.deepEqual(b.sent.map((m) => m.type), ["companion_state"]);
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
