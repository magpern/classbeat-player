// The lifecycle every reader shares (issue #51, item 1), on its own with a fake helper: when it
// runs, which reading it holds, the gate on commands, one command in flight and one waiting,
// giving up, a status between two songs, and a helper that can never start. Pure: no process,
// no timer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCallSlot } from "../../src/core/link/call-slot.ts";
import { createReaderLifecycle, START_FAILURES_LIMIT } from "../../src/core/link/reader-lifecycle.ts";
import type { Answer, ReaderLifecycle } from "../../src/core/link/reader-lifecycle.ts";
import type { Observation, TransportAction } from "../../src/core/link/index.ts";

const obs = (over: Partial<Observation> = {}): Observation => ({ title: "Song", artist: "Artist", lengthMs: 180_000, trackId: null, app: "Spotify", positionMs: 1000, playing: true, at: 0, seenAt: 0, ...over });
const reading = (over: Partial<Observation> = {}): Answer => ({ kind: "reading", obs: obs(over) });
const CLOSED: Answer = { kind: "closed" };
const STOPPED: Answer = { kind: "closed", between: true };

function rig(giveUpMs = Number.POSITIVE_INFINITY): { life: ReaderLifecycle; log: string[]; sent: TransportAction[]; taken: (() => void)[]; clock: { t: number }; helper: { listening: boolean } } {
  const log: string[] = [];
  const sent: TransportAction[] = [];
  const taken: (() => void)[] = [];
  const clock = { t: 0 };
  const helper = { listening: true };
  const life = createReaderLifecycle(
    { now: () => clock.t, giveUpMs },
    {
      start: () => void log.push("start"),
      stop: () => void log.push("stop"),
      command(action, done) {
        sent.push(action);
        taken.push(done);
      },
      listening: () => helper.listening,
    },
  );
  return { life, log, sent, taken, clock, helper };
}

/** Following, and the music app has answered once: the gate is open. */
function open(giveUpMs?: number): ReturnType<typeof rig> {
  const r = rig(giveUpMs);
  r.life.setActive(true);
  r.life.answer(CLOSED);
  return r;
}

test("the helper is started once when following begins and stopped once when it ends", () => {
  const r = rig();
  assert.equal(r.life.active, false);
  r.life.setActive(false);
  assert.deepEqual(r.log, [], "nothing to stop");
  r.life.setActive(true);
  r.life.setActive(true);
  assert.deepEqual(r.log, ["start"]);
  assert.equal(r.life.active, true);
  r.life.setActive(false);
  r.life.setActive(false);
  assert.deepEqual(r.log, ["start", "stop"]);
  r.life.setActive(true);
  assert.deepEqual(r.log, ["start", "stop", "start"]);
});

test("the reading: a good answer replaces it, an unusable one leaves it to age, a lost helper and stopping drop it", () => {
  const r = rig();
  r.life.setActive(true);
  assert.equal(r.life.latest(), null);
  const first = obs({ seenAt: 10 });
  r.life.answer({ kind: "reading", obs: first });
  assert.equal(r.life.latest(), first);
  r.life.failed(true);
  assert.equal(r.life.latest(), first, "the same reading: its own time ages it (rule 8)");
  r.life.answer(CLOSED);
  assert.equal(r.life.latest(), null);
  r.life.answer({ kind: "reading", obs: first });
  r.life.lost(true);
  assert.equal(r.life.latest(), null, "nothing backs it any more");
  r.life.answer({ kind: "reading", obs: first });
  r.life.setActive(false);
  assert.equal(r.life.latest(), null);
  r.life.setActive(true);
  assert.equal(r.life.latest(), null, "following again starts from nothing");
});

test("answers that arrive while not following change nothing", () => {
  const r = rig();
  assert.equal(r.life.answer(reading()), false);
  r.life.failed(false);
  r.life.lost(false);
  assert.equal(r.life.latest(), null);
  assert.equal(r.life.unavailable(), false);
  r.life.send("play");
  assert.deepEqual(r.sent, []);
});

test("the gate: no command before the first good answer; the newest one that waited goes when it comes", () => {
  for (const first of [reading(), reading({ playing: false }), CLOSED, STOPPED]) {
    const r = rig();
    r.life.setActive(true);
    for (const action of ["play", "next", "pause"] as const) r.life.send(action);
    assert.deepEqual(r.sent, [], "nothing is known to be there yet");
    r.life.answer(first);
    assert.deepEqual(r.sent, ["pause"], JSON.stringify(first));
  }
});

test("a command that waits for the gate is given up when the answer is unusable, and never goes late", () => {
  for (const bad of [(l: ReaderLifecycle) => l.failed(true), (l: ReaderLifecycle) => l.failed(false), (l: ReaderLifecycle) => l.lost(true)]) {
    const r = rig();
    r.life.setActive(true);
    r.life.send("next");
    bad(r.life);
    r.life.answer(CLOSED);
    assert.deepEqual(r.sent, [], "what waited is not sent when the music app answers later");
    r.life.send("play");
    assert.deepEqual(r.sent, ["play"], "the gate is open now: a new command goes at once");
  }
});

test("once the gate is open an unusable answer closes nothing: a waiting command stays", () => {
  const r = open();
  r.life.send("pause");
  r.life.send("next");
  r.life.failed(true);
  r.taken[0]();
  assert.deepEqual(r.sent, ["pause", "next"]);
});

test("the gate closes again when following stops and when the helper is lost", () => {
  for (const close of [(l: ReaderLifecycle) => (l.setActive(false), l.setActive(true)), (l: ReaderLifecycle) => l.lost(true)]) {
    const r = open();
    close(r.life);
    r.life.send("play");
    assert.deepEqual(r.sent, []);
    r.life.answer(CLOSED);
    assert.deepEqual(r.sent, ["play"]);
  }
});

test("one command in flight and one waiting: the newest replaces the one that waits", () => {
  const r = open();
  for (const action of ["pause", "next", "play", "next", "pause", "play"] as const) r.life.send(action);
  assert.deepEqual(r.sent, ["pause"], "one in flight");
  r.life.answer(reading());
  assert.deepEqual(r.sent, ["pause"], "an answer to a read is not the command being taken");
  r.taken[0]();
  assert.deepEqual(r.sent, ["pause", "play"], "the newest of the five that waited, and only it");
  r.taken[0]();
  assert.deepEqual(r.sent, ["pause", "play"], "a command is taken once");
  r.taken[1]();
  assert.deepEqual(r.sent, ["pause", "play"]);
  r.life.send("next");
  assert.deepEqual(r.sent, ["pause", "play", "next"], "nothing in flight: it goes at once");
});

test("stopping, or losing the helper, drops what is in flight and what waits; a late answer sends nothing", () => {
  for (const drop of [(l: ReaderLifecycle) => l.setActive(false), (l: ReaderLifecycle) => l.lost(true)]) {
    const r = open();
    r.life.send("pause");
    r.life.send("next");
    drop(r.life);
    r.taken[0]();
    assert.deepEqual(r.sent, ["pause"]);
    r.life.setActive(true);
    r.life.answer(CLOSED);
    assert.deepEqual(r.sent, ["pause"], "nothing reaches a later helper");
  }
});

test("a command that is not taken in time no longer counts as in flight; with no limit only the helper says", () => {
  const timed = open(1400);
  timed.life.send("pause");
  timed.life.send("next");
  timed.clock.t = 1399;
  timed.life.send("next");
  assert.deepEqual(timed.sent, ["pause"]);
  timed.clock.t = 1400;
  timed.life.send("play");
  assert.deepEqual(timed.sent, ["pause", "play"], "the stale waiting command is replaced, not sent besides");
  timed.life.send("next");
  timed.taken[0]();
  assert.deepEqual(timed.sent, ["pause", "play"], "the given-up command's late answer does not let the waiting one go beside the newer one");
  timed.life.send("pause");
  assert.deepEqual(timed.sent, ["pause", "play"], "nor does it free the newer one's place");
  timed.taken[1]();
  assert.deepEqual(timed.sent, ["pause", "play", "pause"]);

  const untimed = open();
  untimed.life.send("pause");
  untimed.clock.t = 3_600_000;
  untimed.life.send("next");
  assert.deepEqual(untimed.sent, ["pause"]);
});

test("only the three names are passed on, and none while no helper is there to take it", () => {
  const r = open();
  for (const bad of ["read", "names", "Play", "previous", "", "toString", "__proto__", "play\n", null, 5, ["play"], { toString: () => "play" }]) r.life.send(bad as never);
  assert.deepEqual(r.sent, []);
  r.helper.listening = false;
  r.life.send("play");
  r.helper.listening = true;
  r.life.answer(CLOSED);
  assert.deepEqual(r.sent, [], "it was not kept for later");
});

test("a status between two songs is held for one poll, then taken as it stands", () => {
  const r = rig();
  r.life.setActive(true);
  const song = obs({ title: "One" });
  r.life.answer({ kind: "reading", obs: song });
  assert.equal(r.life.answer(STOPPED), true, "held");
  assert.equal(r.life.latest(), song, "the reading it had, untouched: its own time goes on");
  assert.equal(r.life.answer(STOPPED), false);
  assert.equal(r.life.latest(), null, "said twice: nothing is loaded");
  assert.equal(r.life.answer(STOPPED), false, "and it is not held again while it lasts");

  const next = obs({ title: "Two" });
  r.life.answer({ kind: "reading", obs: next });
  const nameless: Answer = { kind: "reading", obs: obs({ title: "", artist: "" }), between: true };
  assert.equal(r.life.answer(nameless), true);
  assert.equal(r.life.latest(), next);
  r.life.answer({ kind: "reading", obs: next });
  assert.equal(r.life.answer(nameless), true, "a good answer in between: the next passing status is held again");
  assert.equal(r.life.answer(nameless), false);
  assert.equal(r.life.latest()?.title, "");
});

test("with no reading to hold, a status between two songs is taken at once; held or not, it opens the gate", () => {
  const r = rig();
  r.life.setActive(true);
  r.life.send("play");
  assert.equal(r.life.answer(STOPPED), false);
  assert.deepEqual(r.sent, ["play"]);

  const held = rig();
  held.life.setActive(true);
  held.life.answer(reading());
  held.life.setActive(false);
  held.life.setActive(true);
  assert.equal(held.life.answer(STOPPED), false, "the reading from before following stopped is gone");
});

test("a helper that fails to start this many times in a row cannot work here: the reader stops for good", () => {
  assert.equal(START_FAILURES_LIMIT, 6);
  for (const fail of [(l: ReaderLifecycle) => l.failed(false), (l: ReaderLifecycle) => l.lost(false)]) {
    const r = rig();
    r.life.setActive(true);
    for (let i = 0; i < START_FAILURES_LIMIT - 1; i++) fail(r.life);
    assert.equal(r.life.unavailable(), false);
    assert.deepEqual(r.log, ["start"]);
    fail(r.life);
    assert.equal(r.life.unavailable(), true);
    assert.equal(r.life.active, false);
    assert.deepEqual(r.log, ["start", "stop"], "its helper is stopped");
    r.life.setActive(true);
    r.life.send("play");
    r.life.answer(reading());
    assert.deepEqual(r.log, ["start", "stop"], "and never started again");
    assert.equal(r.life.latest(), null);
    assert.deepEqual(r.sent, []);
    assert.equal(r.life.unavailable(), true);
  }
});

test("only failures to start in a row count: a helper that ran, even badly, starts the count again", () => {
  for (const ran of [(l: ReaderLifecycle) => l.failed(true), (l: ReaderLifecycle) => l.lost(true), (l: ReaderLifecycle) => void l.answer(CLOSED), (l: ReaderLifecycle) => void l.answer(STOPPED)]) {
    const r = rig();
    r.life.setActive(true);
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < START_FAILURES_LIMIT - 1; i++) r.life.failed(false);
      ran(r.life);
    }
    assert.equal(r.life.unavailable(), false);
  }
  // Turning following off and on does not start the count again.
  const r = rig();
  for (let i = 0; i < START_FAILURES_LIMIT; i++) {
    assert.equal(r.life.unavailable(), false);
    r.life.setActive(true);
    r.life.failed(false);
    r.life.setActive(false);
  }
  assert.equal(r.life.unavailable(), true);
});

test("the call slot: one call at a time, given up after its time, and only the newest call's answer counts", () => {
  const clock = { t: 0 };
  const slot = createCallSlot(() => clock.t, 100);
  assert.equal(slot.busy(), false);
  assert.equal(slot.lapsed(), false);
  const first = slot.begin();
  assert.equal(slot.busy(), true);
  clock.t = 99;
  assert.equal(slot.busy(), true);
  assert.equal(slot.lapsed(), false);
  first.renew();
  clock.t = 198;
  assert.equal(slot.busy(), true, "a renewed call has its time again");
  clock.t = 199;
  assert.equal(slot.busy(), false);
  assert.equal(slot.lapsed(), true, "given up without an answer");
  assert.equal(slot.lapsed(), false, "said once");
  assert.equal(first.current(), false);
  assert.equal(first.end(), false, "its late answer is dropped");

  const second = slot.begin();
  const third = slot.begin();
  assert.equal(second.end(), false, "a newer call began");
  second.renew();
  assert.equal(third.current(), true);
  assert.equal(third.end(), true);
  assert.equal(slot.busy(), false);
  assert.equal(slot.lapsed(), false, "it answered");

  const fourth = slot.begin();
  slot.clear();
  assert.equal(slot.busy(), false);
  assert.equal(fourth.end(), false);
});
