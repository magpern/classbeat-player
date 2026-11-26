// The Android reader's answers that arrive late or not at all (issue #901, from the reviews of
// #888 and #890): a follow or reading call that fails stops the reader with a reason the
// instructor can act on, and one that settles after the reader was switched off, or after a new
// start, changes nothing. Native code is a script of promises the test settles by hand.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAndroidReader } from "../src/follow/android-reader.ts";
import type { FollowIntents } from "../src/follow/android-reader.ts";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

interface Pending {
  resolve(v: unknown): void;
  reject(e: unknown): void;
}

interface Held extends FollowIntents {
  readonly follows: Pending[];
  readonly readings: Pending[];
}

/** Native code whose follow and reading calls stay open until the test settles them. */
function held(): Held {
  const follows: Pending[] = [];
  const readings: Pending[] = [];
  const open = (to: Pending[]): Promise<unknown> => new Promise((resolve, reject) => to.push({ resolve, reject }));
  return {
    follows,
    readings,
    follow: () => open(follows),
    unfollow: async () => ({ state: "stopped" }),
    reading: () => open(readings),
    sendPlay: async () => ({ state: "sent" }),
    sendPause: async () => ({ state: "sent" }),
    sendNext: async () => ({ state: "sent" }),
  };
}

function readerOver(f: Held) {
  let poll: (() => void) | null = null;
  const r = createAndroidReader(f, { now: () => 0, every: (fn) => ((poll = fn), () => (poll = null)) });
  return { r, poll: () => poll, tick: async (): Promise<void> => (poll?.(), await flush()) };
}

test("a follow call that fails stops the reader, with the reason shown, and Follow can be tried again", async () => {
  const f = held();
  const { r, poll } = readerOver(f);
  r.setActive?.(true);
  f.follows[0].reject(new Error("no answer"));
  await flush();
  assert.equal(r.stopped?.(), true);
  assert.equal(r.reason?.(), "not-answering");
  assert.equal(r.unavailable?.(), false, "a failed call is not the end of following on this phone");
  assert.equal(poll(), null, "no reading is ever asked for");
  r.setActive?.(true);
  assert.equal(r.stopped?.(), false, "switched on again, it starts afresh");
  assert.equal(r.reason?.(), null);
  assert.equal(f.follows.length, 2);
});

test("a follow call that fails after the reader was switched off changes nothing", async () => {
  const f = held();
  const { r } = readerOver(f);
  r.setActive?.(true);
  r.setActive?.(false);
  f.follows[0].reject(new Error("no answer"));
  await flush();
  assert.equal(r.stopped?.(), false);
  assert.equal(r.reason?.(), null);
});

test("a follow answer that comes after the reader was switched off starts no polling", async () => {
  const f = held();
  const { r, poll } = readerOver(f);
  r.setActive?.(true);
  r.setActive?.(false);
  f.follows[0].resolve({ state: "following" });
  await flush();
  assert.equal(poll(), null);
  assert.equal(r.stopped?.(), false);
});

test("a follow answer of an earlier start does not count once the reader started again", async () => {
  const f = held();
  const { r, poll } = readerOver(f);
  r.setActive?.(true);
  r.setActive?.(false);
  r.setActive?.(true);
  f.follows[0].reject(new Error("late"));
  await flush();
  assert.equal(r.stopped?.(), false, "the old start's failure is ignored");
  f.follows[1].resolve({ state: "following" });
  await flush();
  assert.notEqual(poll(), null, "the new start follows");
});

test("a reading call that fails is a missing answer: the reason shows, the reader keeps asking", async () => {
  const f = held();
  const { r, tick } = readerOver(f);
  r.setActive?.(true);
  f.follows[0].resolve({ state: "following" });
  await flush();
  await tick();
  assert.equal(f.readings.length, 1);
  f.readings[0].reject(new Error("no answer"));
  await flush();
  assert.equal(r.reason?.(), "not-answering");
  assert.equal(r.stopped?.(), false, "a missed reading does not stop following");
  await tick();
  assert.equal(f.readings.length, 2, "the next poll asks again");
});

test("a reading call that fails after the reader was switched off changes nothing", async () => {
  const f = held();
  const { r, tick } = readerOver(f);
  r.setActive?.(true);
  f.follows[0].resolve({ state: "following" });
  await flush();
  await tick();
  r.setActive?.(false);
  f.readings[0].reject(new Error("late"));
  await flush();
  assert.equal(r.reason?.(), null);
});

test("a reading answer that comes after the reader was switched off gives no reading", async () => {
  const f = held();
  const { r, tick } = readerOver(f);
  r.setActive?.(true);
  f.follows[0].resolve({ state: "following" });
  await flush();
  await tick();
  r.setActive?.(false);
  f.readings[0].resolve({ state: "noAccess" });
  await flush();
  assert.equal(r.stopped?.(), false, "a stale access answer stops nothing");
  assert.equal(r.reason?.(), null);
  assert.equal(r.latest(0), null);
});

test("switching off when native code cannot stop following is harmless: no error escapes, the reader is off", async () => {
  const f = held();
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown): number => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    const { r, poll } = readerOver({ ...f, unfollow: () => Promise.reject(new Error("no answer")) });
    r.setActive?.(true);
    f.follows[0].resolve({ state: "following" });
    await flush();
    assert.notEqual(poll(), null);
    r.setActive?.(false);
    await new Promise((res) => setImmediate(res));
    assert.equal(poll(), null, "the poll timer is stopped");
    assert.deepEqual(unhandled, [], "the failed unfollow is swallowed");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
