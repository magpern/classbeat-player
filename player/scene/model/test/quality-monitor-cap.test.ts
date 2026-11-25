// Long gaps and the pause cap (#717): each gap counts at most PAUSE_MS of slow time, so one long pause never takes a step.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PAUSE_MS, observe, startMonitor } from "../src/quality-monitor.ts";

test("two long gaps in a row count at most the pause limit each: a 10 s gap is not a whole step of slow time", () => {
  let s = observe(startMonitor("High"), 0).state;
  s = observe(s, 10_000).state; // the first long gap is a pause: the count restarts
  const second = observe(s, 20_000); // the second is evidence, capped at PAUSE_MS of it
  assert.equal(second.stepped, false);
  assert.equal(second.state.level, "High");
  assert.equal(second.state.lowMs, PAUSE_MS);
  assert.ok(second.row !== null && second.row.fps < 1, "the log still shows the real rate");
});

test("a run of long gaps steps once their capped time reaches 5 s, not after the first or second", () => {
  let s = observe(startMonitor("High"), 0).state;
  const stepsAt: number[] = [];
  for (let i = 1; i <= 6; i++) {
    const r = observe(s, i * 10_000);
    s = r.state;
    if (r.stepped) stepsAt.push(i);
  }
  assert.deepEqual(stepsAt, [4], "the first gap restarts the count, then 2 s each: 2, 4, 6 s on the 4th gap");
});
