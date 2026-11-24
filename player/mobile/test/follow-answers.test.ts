// The follow intents' answers are read strictly, and the Android reader keeps the shared
// lifecycle's rules: garbage changes nothing, stopping forgets, a late answer is dropped (#632).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  observationOf,
  parseAccess,
  parseFollow,
  parseReading,
} from "../src/follow/answers.ts";
import { createAndroidReader } from "../src/follow/android-reader.ts";

const fields = {
  trackId: "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
  title: "Song A",
  artist: "Band A",
  lengthMs: 180_000,
  playing: true,
  positionMs: 42_000,
  ageMs: 800,
};

test("a reading answer is read strictly, field by field", () => {
  assert.deepEqual(parseReading({ state: "reading", reading: fields }), {
    kind: "reading",
    fields,
  });
  assert.deepEqual(
    parseReading({
      state: "reading",
      reading: { ...fields, trackId: null, lengthMs: null },
    })?.kind,
    "reading",
  );
  for (const k of ["nothing", "unavailable", "noAccess", "stopped"] as const)
    assert.deepEqual(parseReading({ state: k }), { kind: k });
  const bad: unknown[] = [
    undefined,
    null,
    "reading",
    [],
    {},
    { state: "reading" },
    { state: "reading", reading: fields, app: "x" },
    { state: "nothing", reading: fields },
    { state: "Reading", reading: fields },
    { state: "reading", reading: { ...fields, extra: 1 } },
    { state: "reading", reading: { ...fields, ageMs: -1 } },
    { state: "reading", reading: { ...fields, positionMs: Number.NaN } },
    { state: "reading", reading: { ...fields, positionMs: "1" } },
    { state: "reading", reading: { ...fields, lengthMs: 0 } },
    { state: "reading", reading: { ...fields, playing: 1 } },
    { state: "reading", reading: { ...fields, trackId: "" } },
    { state: "reading", reading: { ...fields, title: "", trackId: null } },
  ];
  for (const b of bad) assert.equal(parseReading(b), null, JSON.stringify(b));
});

test("follow and access answers: anything unexpected means the manual clock", () => {
  assert.equal(parseFollow({ state: "following" }), "following");
  assert.equal(parseFollow({ state: "noAccess" }), "noAccess");
  for (const b of [
    undefined,
    {},
    { state: "Following" },
    { state: "following", x: 1 },
    "following",
  ])
    assert.equal(parseFollow(b), "unavailable");
  assert.equal(parseAccess({ granted: true }), true);
  for (const b of [
    undefined,
    { granted: "true" },
    { granted: true, x: 1 },
    { granted: false },
  ])
    assert.equal(parseAccess(b), false);
});

test("a reading is dated on the page's clock: the call's midpoint less its age; a call running backwards is not dated", () => {
  const f = parseReading({ state: "reading", reading: fields });
  assert.ok(f?.kind === "reading");
  const { ageMs, ...rest } = fields;
  assert.deepEqual(observationOf(f.fields, 10_000, 10_020), {
    ...rest,
    at: 10_010 - ageMs,
    seenAt: 10_020,
  });
  assert.equal(observationOf(f.fields, 10_020, 10_000), null);
  assert.equal(observationOf(f.fields, Number.NaN, 10_000), null);
});

/** A native side whose answers the test hands out by hand. */
function manual() {
  const calls: string[] = [];
  const pending: ((v: unknown) => void)[] = [];
  const ask = (name: string) => () => {
    calls.push(name);
    return new Promise<unknown>((r) => pending.push(r));
  };
  return {
    calls,
    pending,
    intents: {
      follow: ask("follow"),
      unfollow: ask("unfollow"),
      reading: ask("reading"),
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

test("garbage keeps the last reading; nothing clears it; stopping forgets it, says unfollow and drops a late answer", async () => {
  let now = 1000;
  let tick: (() => void) | null = null;
  const n = manual();
  const reader = createAndroidReader(n.intents, {
    now: () => now,
    every: (fn) => ((tick = fn), () => (tick = null)),
  });
  assert.equal(reader.kind, "android");
  reader.setActive?.(true);
  n.pending.shift()!({ state: "following" });
  await flush();
  tick!();
  n.pending.shift()!({ state: "reading", reading: fields });
  await flush();
  assert.equal(reader.latest(now)?.title, "Song A");
  tick!();
  tick!();
  assert.equal(
    n.calls.filter((c) => c === "reading").length,
    2,
    "one reading in flight at a time",
  );
  n.pending.shift()!({ state: "reading", reading: { ...fields, ageMs: "x" } });
  await flush();
  assert.equal(reader.latest(now)?.title, "Song A", "garbage changes nothing");
  assert.equal(reader.reason?.(), "not-answering");
  tick!();
  n.pending.shift()!({ state: "nothing" });
  await flush();
  assert.equal(reader.latest(now), null);
  tick!();
  reader.setActive?.(false);
  assert.equal(tick, null, "polling stops");
  assert.equal(n.calls.at(-1), "unfollow");
  n.pending.shift()!({ state: "reading", reading: fields });
  await flush();
  assert.equal(
    reader.latest(now),
    null,
    "an answer to the stopped run is dropped",
  );
  now += 100;
  assert.equal(reader.latest(now), null);
});

test("access taken back while following stops the reader, which may start again later", async () => {
  let tick: (() => void) | null = null;
  const n = manual();
  const reader = createAndroidReader(n.intents, {
    now: () => 0,
    every: (fn) => ((tick = fn), () => (tick = null)),
  });
  reader.setActive?.(true);
  n.pending.shift()!({ state: "following" });
  await flush();
  tick!();
  n.pending.shift()!({ state: "noAccess" });
  await flush();
  assert.equal(tick, null);
  assert.equal(reader.reason?.(), "not-permitted");
  assert.equal(reader.unavailable?.(), false);
  reader.setActive?.(true);
  assert.equal(n.calls.filter((c) => c === "follow").length, 2);
});
