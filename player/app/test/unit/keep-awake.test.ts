// Keep the display awake: the pure policy over every clock state, and a fake blocker showing
// start and stop stay balanced.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mustKeepAwake } from "../../src/core/awake/keep-awake-policy.ts";
import type { ClockView } from "../../src/core/clock/index.ts";
import type { Status } from "../../src/core/clock/index.ts";
import { createKeepAwake } from "../../src/main/keep-awake.ts";

const view = (status: Status): ClockView => ({
  mode: "manual",
  status,
  classMs: 0,
  lengthMs: 1000,
  classRemainingMs: 1000,
  intervalIndex: 0,
  intervalElapsedMs: 0,
  intervalRemainingMs: 1000,
  nextIntervalIndex: null,
  holding: status === "ended",
  songIndex: null,
  plannedCrossfadeMs: 0,
  measuredCrossfadeMs: null,
});

const POLICY: [string, ClockView | null, boolean][] = [
  ["no class open", null, false],
  ["ready", view("ready"), false],
  ["running", view("running"), true],
  ["paused", view("paused"), false],
  ["ended", view("ended"), false],
];
for (const [name, v, want] of POLICY) {
  test(`policy: ${name} -> ${want}`, () => assert.equal(mustKeepAwake(v), want));
}

function fake() {
  const held = new Set<number>();
  let next = 1;
  let starts = 0;
  return {
    held,
    starts: () => starts,
    start(type: "prevent-display-sleep") {
      assert.equal(type, "prevent-display-sleep");
      assert.equal(held.size, 0, "never two blockers at once");
      starts += 1;
      held.add(next);
      return next++;
    },
    stop(id: number) {
      assert.ok(held.delete(id), "stops only a held id");
    },
  };
}

test("blocker: held exactly while running, started once, stopped on every no", () => {
  const b = fake();
  const k = createKeepAwake(b);
  const steps: [ClockView | null, number][] = [
    [null, 0],
    [view("ready"), 0],
    [view("running"), 1],
    [view("running"), 1],
    [view("paused"), 0],
    [view("paused"), 0],
    [view("running"), 1],
    [view("ended"), 0],
    [view("running"), 1],
    [null, 0],
  ];
  for (const [v, held] of steps) {
    k.update(v);
    assert.equal(b.held.size, held);
  }
  assert.equal(b.starts(), 3);
});

test("blocker: none left after release (quit or presenter closed), release is idempotent", () => {
  const b = fake();
  const k = createKeepAwake(b);
  k.release();
  k.update(view("running"));
  k.release();
  k.release();
  assert.equal(b.held.size, 0);
  k.update(view("running"));
  assert.equal(b.held.size, 1);
  k.release();
  assert.equal(b.held.size, 0);
});
