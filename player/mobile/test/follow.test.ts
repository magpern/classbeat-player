// The phone's follower through the shared music link (issue #632): a fake native follower answers
// instructor mode's follow intents, the Android reader turns its answers into readings, and the
// desktop's own state machine (player/app/src/core/link) steps on them every 100 ms. No phone, no
// music app, no network: native code is a script. Spotify-style ids appear only here, in fixtures.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createClock,
  positionAt,
  tick,
} from "../../app/src/core/clock/index.ts";
import {
  initialLink,
  linkViewAt,
  step,
  undo,
} from "../../app/src/core/link/index.ts";
import type {
  LinkEvent,
  LinkModel,
  LinkPlan,
} from "../../app/src/core/link/index.ts";
import {
  classLength,
  makePlan,
  SONG_MS,
} from "../../app/test/unit/link-harness.ts";
import { createAndroidReader, POLL_MS } from "../src/follow/android-reader.ts";
import type { FollowIntents } from "../src/follow/android-reader.ts";

/** What the music app does from `from` on, as native code would report it. */
interface Seg {
  readonly from: number;
  readonly name: string;
  readonly pos: number;
  readonly playing: boolean;
  /** Native code does not answer during this segment (the reading call fails). */
  readonly quiet?: boolean;
  readonly trackId?: string | null;
}

const play = (
  from: number,
  name: string,
  pos: number,
  more: Partial<Seg> = {},
): Seg => ({ from, name, pos, playing: true, ...more });
const pauseAt = (
  from: number,
  name: string,
  pos: number,
  more: Partial<Seg> = {},
): Seg => ({ from, name, pos, playing: false, ...more });

interface FakeNative extends FollowIntents {
  readonly calls: string[];
}

/**
 * Native code on a script. The system sets the position when a segment begins and not again, so
 * each answer says how long ago that was (`ageMs`): the reader must date the reading from it.
 */
function fakeNative(
  segs: readonly Seg[],
  now: () => number,
  follow: unknown = { state: "following" },
): FakeNative {
  const calls: string[] = [];
  return {
    calls,
    follow: async () => (calls.push("follow"), follow),
    unfollow: async () => (calls.push("unfollow"), { state: "stopped" }),
    reading: async () => {
      calls.push("reading");
      const seg = [...segs].reverse().find((s) => s.from <= now());
      if (!seg) return { state: "nothing" };
      if (seg.quiet) throw new Error("no answer");
      const reading = {
        trackId: seg.trackId ?? null,
        title: `Song ${seg.name}`,
        artist: `Band ${seg.name}`,
        lengthMs: SONG_MS,
        playing: seg.playing,
        positionMs: seg.pos,
        ageMs: now() - seg.from,
      };
      return { state: "reading", reading };
    },
    // No command is sent in these runs (follow-commands.test.ts covers them): each would be logged.
    sendPlay: async () => (calls.push("play"), { state: "sent" }),
    sendPause: async () => (calls.push("pause"), { state: "sent" }),
    sendNext: async () => (calls.push("next"), { state: "sent" }),
  };
}

interface Row {
  readonly now: number;
  readonly state: LinkModel["state"];
  readonly classMs: number;
  readonly events: readonly LinkEvent[];
  readonly canUndo: boolean;
  readonly announcement: string | null;
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Steps the shared link every 100 ms on the Android reader's readings, like the shell's tick. */
async function run(o: {
  plan: LinkPlan;
  segs: readonly Seg[];
  until: number;
  follow?: unknown;
  undoAt?: number;
}) {
  let now = 0;
  const timers: { fn: () => void; ms: number; next: number; on: boolean }[] =
    [];
  const every = (fn: () => void, ms: number): (() => void) => {
    const t = { fn, ms, next: now + ms, on: true };
    timers.push(t);
    return () => void (t.on = false);
  };
  const native = fakeNative(o.segs, () => now, o.follow);
  const reader = createAndroidReader(native, { now: () => now, every });
  reader.setActive?.(true);
  await flush();
  let link = initialLink(true);
  let clock = createClock(classLength(o.plan), 0);
  const rows: Row[] = [];
  for (; now <= o.until; now += 100) {
    for (const t of timers)
      if (t.on && now >= t.next) {
        t.next += t.ms;
        t.fn();
      }
    await flush();
    const events: LinkEvent[] = [];
    if (o.undoAt === now) {
      const r = undo(link, clock, now);
      link = r.link;
      clock = r.clock;
      if (r.event) events.push(r.event);
    }
    const r = step(link, clock, o.plan, reader.latest(now), now);
    link = r.link;
    clock = tick(r.clock, now);
    if (r.event) events.push(r.event);
    const view = linkViewAt(
      link,
      clock,
      o.plan,
      classLength(o.plan),
      now,
      true,
    );
    rows.push({
      now,
      state: link.state,
      classMs: positionAt(clock, now),
      events,
      canUndo: view.canUndo,
      announcement: view.announcement,
    });
  }
  const at = (t: number): Row =>
    rows.find((r) => r.now === t) ?? assert.fail(`no row at ${t}`);
  return { rows, at, reader, native };
}

const plan = makePlan(["A", "B", "C", "D"]);

test("lock: the first reading locks the clock to the music, dated by the age native code gives", async () => {
  const t = await run({ plan, segs: [play(1000, "A", 0)], until: 10_000 });
  assert.equal(t.at(900).state, "Manual");
  assert.equal(t.at(1000).state, "Locked");
  assert.deepEqual(t.at(1000).events, ["locked"]);
  for (const now of [2000, 5000, 10_000])
    assert.equal(t.at(now).classMs, now - 1000);
  assert.equal(t.at(5000).announcement, null);
  assert.equal(POLL_MS, 500);
});

test("lock by id: a provider id from native code matches the class's own id", async () => {
  const id = "4uLU6hMCjMI75M1A2tKUQC";
  const withIds: LinkPlan = {
    ...plan,
    songs: plan.songs.map((s, i) =>
      i === 1 ? { ...s, title: "Other title", trackIds: [id] } : s,
    ),
  };
  const t = await run({
    plan: withIds,
    segs: [play(1000, "B", 0, { trackId: `spotify:track:${id}` })],
    until: 3000,
  });
  assert.equal(t.at(1000).state, "Locked");
  assert.equal(t.at(3000).classMs, withIds.songs[1].startMs + 2000);
});

test("coasting: native code stops answering, the last reading ages and the clock runs on by itself within 3 s", async () => {
  const t = await run({
    plan,
    segs: [play(1000, "A", 0), play(11_000, "A", 10_000, { quiet: true })],
    until: 20_000,
  });
  assert.equal(
    t.at(13_000).state,
    "Locked",
    "the last reading, at 10.5 s, is still current",
  );
  assert.equal(t.at(13_600).state, "Coasting");
  assert.deepEqual(
    t.rows.filter((r) => r.now > 11_000).flatMap((r) => r.events),
    ["coasting"],
  );
  assert.equal(t.at(20_000).classMs, 19_000, "it keeps running");
  assert.ok(
    t.rows.every((r, i) => i === 0 || r.classMs >= t.rows[i - 1].classMs),
    "never backwards by itself (rule 4)",
  );
});

test("re-lock: readings come back after 30 s with the music paused, the clock goes back to its place with an undo", async () => {
  const t = await run({
    plan,
    segs: [
      play(1000, "A", 0),
      pauseAt(11_000, "A", 10_000, { quiet: true }),
      pauseAt(41_000, "A", 10_000),
    ],
    until: 45_000,
  });
  assert.equal(t.at(40_900).state, "Coasting");
  const back = t.at(41_000);
  assert.equal(back.state, "Paused");
  assert.deepEqual(back.events, ["relock"]);
  assert.equal(back.classMs, 10_000);
  assert.equal(back.announcement, "resynced, 30 s back");
  assert.equal(back.canUndo, true);
});

test("undo: the resync is undone to where the manual clock would be, and the music no longer moves it", async () => {
  const t = await run({
    plan,
    segs: [
      play(1000, "A", 0),
      pauseAt(11_000, "A", 10_000, { quiet: true }),
      pauseAt(41_000, "A", 10_000),
    ],
    until: 46_000,
    undoAt: 42_000,
  });
  assert.equal(t.at(41_000).classMs, 10_000);
  assert.deepEqual(t.at(42_000).events, ["undo"]);
  assert.equal(t.at(42_000).state, "Manual");
  assert.equal(t.at(42_000).classMs, 41_000);
  assert.equal(t.at(46_000).classMs, 45_000);
  assert.equal(t.at(46_000).canUndo, false);
});

test("the stand-in source: native code says unavailable, the reader stops for good and the clock stays manual", async () => {
  const t = await run({
    plan,
    segs: [play(1000, "A", 0)],
    until: 5000,
    follow: { state: "unavailable" },
  });
  assert.ok(t.rows.every((r) => r.state === "Manual" && r.classMs === 0));
  assert.equal(t.reader.unavailable?.(), true);
  assert.equal(t.reader.latest(5000), null);
  assert.deepEqual(
    t.native.calls,
    ["follow", "unfollow"],
    "it never asks for a reading",
  );
  t.reader.setActive?.(true);
  await flush();
  assert.deepEqual(
    t.native.calls,
    ["follow", "unfollow"],
    "and never starts again",
  );
});

test("no notification access: the reader stops, says so, and the clock stays manual", async () => {
  const t = await run({
    plan,
    segs: [play(1000, "A", 0)],
    until: 3000,
    follow: { state: "noAccess" },
  });
  assert.ok(t.rows.every((r) => r.state === "Manual"));
  assert.equal(t.reader.reason?.(), "not-permitted");
  assert.equal(t.reader.unavailable?.(), false, "access can still be granted");
  assert.ok(!t.native.calls.includes("reading"));
});
