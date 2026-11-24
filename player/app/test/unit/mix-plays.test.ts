// The live plays (main/mix/plays.ts): one at a time, 128 random bits, bound to a window, an account and a mix.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlays } from "../../src/main/mix/plays.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);

test("a play id is 16 random bytes as hex, and live only from its own window", () => {
  const asked: number[] = [];
  const plays = createPlays((n) => {
    asked.push(n);
    return Buffer.alloc(n, 0xab);
  });
  const p = plays.begin(7, A, "mix_1");
  assert.deepEqual(asked, [16]);
  assert.equal(p.id, "ab".repeat(16));
  assert.deepEqual(p, { id: p.id, webContentsId: 7, account: A, mixId: "mix_1" });
  assert.equal(plays.liveFrom(p.id, 7), p);
  assert.equal(plays.liveFrom(p.id, 8), null);
  assert.equal(plays.liveFrom("ab".repeat(15), 7), null);
  assert.equal(plays.live(p.id), p);
  assert.equal(plays.live("cd".repeat(16)), null);
});

test("ids differ with the real random source, and a new play ends the one before", () => {
  const plays = createPlays();
  const one = plays.begin(1, A, "m");
  const two = plays.begin(1, A, "m");
  assert.notEqual(one.id, two.id);
  assert.match(two.id, /^[0-9a-f]{32}$/);
  assert.equal(plays.live(one.id), null, "stale");
  assert.equal(plays.liveFrom(one.id, 1), null, "stale");
  assert.equal(plays.live(two.id), two);
});

test("end, endFor and endAccount end the play only when it matches", () => {
  const plays = createPlays();
  let p = plays.begin(1, A, "m");
  plays.endFor(2);
  plays.endAccount(B);
  assert.equal(plays.live(p.id), p);
  plays.endFor(1);
  assert.equal(plays.live(p.id), null);
  p = plays.begin(1, A, "m");
  plays.endAccount(A);
  assert.equal(plays.live(p.id), null);
  p = plays.begin(1, A, "m");
  plays.end();
  assert.equal(plays.live(p.id), null);
});
