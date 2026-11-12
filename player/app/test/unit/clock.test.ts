// The manual class clock, table-driven: every ADR 0001 rule the manual clock covers.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createClock,
  jump,
  JUMP_MS,
  moveTo,
  nextInterval,
  pause,
  positionAt,
  previousInterval,
  PREVIOUS_RESTART_MS,
  resume,
  start,
  tick,
} from "../../src/core/clock/index.ts";
import type { ClockPlan, ClockState, Status } from "../../src/core/clock/index.ts";

// Three one-minute intervals, a three-minute class.
const PLAN: ClockPlan = {
  lengthMs: 180_000,
  intervals: [
    { startMs: 0, endMs: 60_000 },
    { startMs: 60_000, endMs: 120_000 },
    { startMs: 120_000, endMs: 180_000 },
  ],
  songs: [],
  plannedCrossfadeMs: 0,
  manualOnly: true,
};

type Op = "start" | "pause" | "resume" | "next" | "previous" | "fwd" | "back" | "tick";
type Step = readonly [op: Op, now: number, status: Status, classMs: number];

function apply(s: ClockState, op: Op, now: number): ClockState {
  switch (op) {
    case "start":
      return start(s, now);
    case "pause":
      return pause(s, now);
    case "resume":
      return resume(s, now);
    case "next":
      return nextInterval(s, PLAN, now);
    case "previous":
      return previousInterval(s, PLAN, now);
    case "fwd":
      return jump(s, JUMP_MS, now);
    case "back":
      return jump(s, -JUMP_MS, now);
    case "tick":
      return tick(s, now);
  }
}

// Each case starts from a fresh clock created at monotonic time 1000.
const CASES: readonly { name: string; steps: readonly Step[] }[] = [
  { name: "a ready clock does not move", steps: [["tick", 50_000, "ready", 0]] },
  { name: "start runs from 0", steps: [["start", 1000, "running", 0], ["tick", 6000, "running", 5000]] },
  {
    name: "pause stops, resume continues from the same place",
    steps: [
      ["start", 1000, "running", 0],
      ["pause", 6000, "paused", 5000],
      ["tick", 20_000, "paused", 5000],
      ["resume", 20_000, "running", 5000],
      ["tick", 25_000, "running", 10_000],
    ],
  },
  {
    name: "start, pause and resume in the wrong state change nothing",
    steps: [
      ["pause", 2000, "ready", 0],
      ["resume", 3000, "ready", 0],
      ["start", 4000, "running", 0],
      ["start", 5000, "running", 1000],
      ["resume", 6000, "running", 2000],
      ["pause", 7000, "paused", 3000],
      ["pause", 8000, "paused", 3000],
      ["start", 9000, "paused", 3000],
    ],
  },
  {
    name: "next goes to the next interval's start and keeps running",
    steps: [["start", 1000, "running", 0], ["next", 11_000, "running", 60_000], ["tick", 12_000, "running", 61_000]],
  },
  { name: "next on the last interval does nothing", steps: [["start", 1000, "running", 0], ["next", 1000, "running", 60_000], ["next", 1000, "running", 120_000], ["next", 2000, "running", 121_000]] },
  {
    name: "previous within 3 s of an interval's start goes to the interval before",
    steps: [["start", 1000, "running", 0], ["next", 1000, "running", 60_000], ["previous", 1000 + PREVIOUS_RESTART_MS - 1, "running", 0]],
  },
  {
    name: "previous later in an interval goes back to its start (intervals replay on purpose)",
    steps: [["start", 1000, "running", 0], ["next", 1000, "running", 60_000], ["previous", 1000 + PREVIOUS_RESTART_MS, "running", 60_000]],
  },
  { name: "previous in the first interval goes to 0", steps: [["start", 1000, "running", 0], ["previous", 2000, "running", 0], ["previous", 30_000, "running", 0]] },
  {
    name: "jumps move by 5 s either way",
    steps: [["start", 1000, "running", 0], ["fwd", 11_000, "running", 15_000], ["back", 11_000, "running", 10_000], ["back", 11_000, "running", 5000]],
  },
  { name: "a jump back never goes before 0", steps: [["start", 1000, "running", 0], ["back", 3000, "running", 0]] },
  {
    name: "rule 2/6: the clock holds at the class end and never runs beyond it",
    steps: [["start", 1000, "running", 0], ["tick", 181_000, "ended", 180_000], ["tick", 400_000, "ended", 180_000]],
  },
  { name: "a jump past the end ends the class", steps: [["start", 1000, "running", 0], ["next", 1000, "running", 60_000], ["next", 1000, "running", 120_000], ["tick", 58_000, "running", 177_000], ["fwd", 58_000, "ended", 180_000]] },
  {
    name: "moving back from the end leaves the clock paused there",
    steps: [["start", 1000, "running", 0], ["tick", 200_000, "ended", 180_000], ["back", 201_000, "paused", 175_000], ["tick", 210_000, "paused", 175_000], ["resume", 210_000, "running", 175_000]],
  },
  { name: "previous from the end goes to the last interval's start, paused", steps: [["start", 1000, "running", 0], ["tick", 200_000, "ended", 180_000], ["previous", 200_000, "paused", 120_000]] },
  { name: "next at the end does nothing", steps: [["start", 1000, "running", 0], ["tick", 200_000, "ended", 180_000], ["next", 201_000, "ended", 180_000]] },
  {
    name: "skips while paused stay paused",
    steps: [["start", 1000, "running", 0], ["pause", 2000, "paused", 1000], ["next", 3000, "paused", 60_000], ["fwd", 4000, "paused", 65_000], ["tick", 90_000, "paused", 65_000]],
  },
  {
    name: "skips before the start stay ready, and start runs from there",
    steps: [["next", 2000, "ready", 60_000], ["back", 3000, "ready", 55_000], ["start", 4000, "running", 55_000], ["tick", 5000, "running", 56_000]],
  },
  {
    name: "rule 4: an earlier monotonic reading never moves the clock back",
    steps: [["start", 1000, "running", 0], ["tick", 10_000, "running", 9000], ["tick", 4000, "running", 9000], ["tick", 11_000, "running", 10_000]],
  },
  {
    name: "rule 4: a command with an earlier reading uses the latest time seen",
    steps: [["start", 1000, "running", 0], ["tick", 10_000, "running", 9000], ["pause", 2000, "paused", 9000]],
  },
];

for (const c of CASES) {
  test(`clock: ${c.name}`, () => {
    let s = createClock(PLAN.lengthMs, 1000);
    for (const [i, [op, now, status, classMs]] of c.steps.entries()) {
      s = apply(s, op, now);
      assert.equal(s.status, status, `step ${i} (${op} at ${now}): status`);
      assert.equal(positionAt(s, now), classMs, `step ${i} (${op} at ${now}): class time`);
    }
  });
}

test("rule 4: without commands the clock never moves backwards, whatever the readings", () => {
  // A deterministic jittery sequence of monotonic readings, some of them earlier than the last.
  let s = start(createClock(PLAN.lengthMs, 0), 0);
  let seed = 7;
  let last = 0;
  for (let i = 0; i < 5000; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const now = i * 40 + (seed % 400) - 200;
    s = tick(s, now);
    const pos = positionAt(s, now);
    assert.ok(pos >= last, `moved back from ${last} to ${pos} at reading ${i}`);
    assert.ok(pos <= PLAN.lengthMs);
    last = pos;
  }
});

test("rule 4: class time only goes backwards through an instructor command", () => {
  let s = start(createClock(PLAN.lengthMs, 0), 0);
  s = tick(s, 30_000);
  assert.equal(positionAt(s, 30_000), 30_000);
  s = moveTo(s, 10_000, 30_000);
  assert.equal(positionAt(s, 30_000), 10_000);
  assert.equal(s.status, "running");
});

test("positionAt never runs beyond the class even without a tick", () => {
  const s = start(createClock(PLAN.lengthMs, 0), 0);
  assert.equal(positionAt(s, 10_000_000), PLAN.lengthMs);
});

test("the clock is pure: a command returns a new state and leaves the old one unchanged", () => {
  const s0 = createClock(PLAN.lengthMs, 1000);
  const frozen = JSON.stringify(s0);
  const s1 = start(s0, 2000);
  assert.notEqual(s0, s1);
  assert.equal(JSON.stringify(s0), frozen);
});
