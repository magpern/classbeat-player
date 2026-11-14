// The rider_state publish policy (issue #361, ADR 0007 section 8 item 5): at once on a change of
// status or interval, otherwise every 2 s, at most 2 in any second. Pure.
import assert from "node:assert/strict";
import { test } from "node:test";
import { newRiderPolicy, riderDue, riderPublished, riderWakeAt, RIDER_HEARTBEAT_MS } from "../../src/core/live/rider-policy.ts";
import type { RiderKey, RiderPolicy } from "../../src/core/live/rider-policy.ts";

const K = (status: string, index: number): RiderKey => ({ status, index });
const A = K("running", 0);

/** A policy after publishing `key` at each of `times`. */
const after = (key: RiderKey, ...times: number[]): RiderPolicy => times.reduce((p, t) => riderPublished(p, key, t), newRiderPolicy());

interface Row {
  readonly name: string;
  readonly policy: RiderPolicy;
  readonly key: RiderKey;
  readonly now: number;
  readonly due: boolean;
  readonly wake: number;
}

const TABLE: readonly Row[] = [
  { name: "the first state is due at once", policy: newRiderPolicy(), key: A, now: 5000, due: true, wake: 5000 },
  { name: "unchanged, 1 s after the last: wait", policy: after(A, 0), key: A, now: 1000, due: false, wake: 2000 },
  { name: "unchanged, just before 2 s: wait", policy: after(A, 0), key: A, now: 1999, due: false, wake: 2000 },
  { name: "unchanged, 2 s after the last: heartbeat", policy: after(A, 0), key: A, now: 2000, due: true, wake: 2000 },
  { name: "a changed interval is due at once", policy: after(A, 0), key: K("running", 1), now: 1000, due: true, wake: 1000 },
  { name: "a changed status is due at once", policy: after(A, 0), key: K("paused", 0), now: 1000, due: true, wake: 1000 },
  { name: "a change within 2 per second waits for room", policy: after(A, 0, 300), key: K("running", 1), now: 500, due: false, wake: 1000 },
  { name: "a change is due once the window has room", policy: after(A, 0, 300), key: K("running", 1), now: 1000, due: true, wake: 1000 },
  { name: "one published in the window leaves room for a change", policy: after(A, 0), key: K("running", 1), now: 100, due: true, wake: 100 },
  { name: "the heartbeat counts from the last publish, not the first", policy: after(A, 0, 1500), key: A, now: 2000, due: false, wake: 3500 },
  { name: "a change back to an earlier key is a change", policy: after(K("running", 1), 0), key: A, now: 100, due: true, wake: 100 },
];

for (const r of TABLE) {
  test(`policy: ${r.name}`, () => {
    assert.equal(riderDue(r.policy, r.key, r.now), r.due);
    assert.equal(riderWakeAt(r.policy, r.key, r.now), r.wake);
  });
}

test("a burst of changes never publishes more than 2 in any second", () => {
  let p = newRiderPolicy();
  const times: number[] = [];
  for (let now = 0; now <= 10_000; now += 10) {
    const key = K("running", Math.floor(now / 10)); // a new interval at every step
    if (riderDue(p, key, now)) {
      p = riderPublished(p, key, now);
      times.push(now);
    }
  }
  for (const t of times) assert.ok(times.filter((u) => u >= t && u < t + 1000).length <= 2, `window at ${t}`);
  assert.ok(times.length >= 18, "and it keeps publishing at the cap");
});

test("steady state publishes every 2 s", () => {
  let p = newRiderPolicy();
  const times: number[] = [];
  for (let now = 0; now <= 10_000; now += 50) {
    if (riderDue(p, A, now)) {
      p = riderPublished(p, A, now);
      times.push(now);
    }
  }
  assert.deepEqual(times, [0, 2000, 4000, 6000, 8000, 10_000]);
  assert.equal(RIDER_HEARTBEAT_MS, 2000);
});
