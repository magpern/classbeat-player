// Access taken back while the desktop follows the music (issue #889, as the phone does since #883):
// the macOS reader reports "not-permitted", and the controller hands the clock to the manual one at
// once through the shared reducer. Fakes only: a reader whose reason a test sets, a recording follower.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { MusicReader, MusicTransport, Observation, TransportAction } from "../../src/core/link/index.ts";
import type { NoReadingReason } from "../../src/core/link/reader.ts";
import { createController } from "../../src/main/controller.ts";
import { CONVERTER_FIXTURES } from "./fixtures.ts";

const doc = JSON.parse(readFileSync(join(CONVERTER_FIXTURES, "class-30min-spotify-playlist.expected.json"), "utf8")) as { songs: { title: string; artist: string; length_ms: number }[] };
const song = (at: number): Observation => ({ title: doc.songs[0].title, artist: doc.songs[0].artist, lengthMs: doc.songs[0].length_ms, positionMs: 0, playing: true, at, seenAt: at });
const TEXT = readFileSync(join(CONVERTER_FIXTURES, "class-30min-spotify-playlist.expected.json"), "utf8");

interface Fake extends MusicReader, MusicTransport {
  obs: Observation | null;
  why: NoReadingReason | null;
  readonly sent: TransportAction[];
  readonly active: boolean[];
}

function fake(): Fake {
  const self: Fake = {
    kind: "fake",
    obs: null,
    why: null,
    sent: [],
    active: [],
    latest: () => self.obs,
    reason: () => self.why,
    setActive: (on) => void self.active.push(on),
    send: (a) => void self.sent.push(a),
  };
  return self;
}

/** Following, locked on song 1 and running. */
function following(): { f: Fake; c: ReturnType<typeof createController>; clock: { t: number } } {
  const f = fake();
  const clock = { t: 1000 };
  const c = createController(() => clock.t, f, f);
  c.open("class.json", TEXT);
  c.command({ type: "follow" });
  clock.t = 1500;
  f.obs = song(clock.t);
  assert.equal(c.snapshot().link?.state, "Locked");
  return { f, c, clock };
}

test("access taken back while following: the clock is manual, the music key shows stopped, the next press sends nothing to the music", () => {
  const { f, c, clock } = following();
  assert.equal(c.snapshot().link?.mode, "following");
  f.why = "not-permitted";
  clock.t = 2000;
  const snap = c.snapshot();
  assert.equal(snap.link?.mode, "manual");
  assert.notEqual(snap.link?.announcement ?? null, null, "Following stopped is announced");
  assert.equal(snap.link?.noReading, "not-permitted", "the reason stays on the screen");
  assert.equal(snap.view?.status, "running", "the clock goes on by hand at once");
  assert.equal(f.active.at(-1), false, "the reader is switched off with it");
  const sentBefore = f.sent.length;
  clock.t = 2500;
  const after = c.command({ type: "pause" });
  assert.equal(after.view?.status, "paused", "the press goes to the manual clock");
  assert.equal(f.sent.length, sentBefore, "no transport command for the press");
  c.command({ type: "resume" });
  assert.equal(f.sent.length, sentBefore, "nor for the next one");
});

test("the press that finds access gone is handled as manual too: no command goes to the music", () => {
  const { f, c, clock } = following();
  f.why = "not-permitted";
  clock.t = 2000;
  const sentBefore = f.sent.length;
  const snap = c.command({ type: "pause" }); // no frame in between
  assert.equal(snap.link?.mode, "manual");
  assert.equal(snap.view?.status, "paused");
  assert.equal(f.sent.length, sentBefore);
});

test("other reasons do not hand over: a reader that is only not answering keeps following", () => {
  for (const why of ["not-running", "waiting-for-permission", "not-answering", "script-failed"] as NoReadingReason[]) {
    const { f, c, clock } = following();
    f.why = why;
    clock.t = 2000;
    assert.equal(c.snapshot().link?.mode, "following", why);
  }
});

test("access never given (the first prompt refused, no reading yet): following stays, with the reason shown", () => {
  const f = fake();
  const clock = { t: 1000 };
  const c = createController(() => clock.t, f, f);
  c.open("class.json", TEXT);
  c.command({ type: "follow" });
  f.why = "not-permitted";
  clock.t = 2000;
  const snap = c.snapshot();
  assert.equal(snap.link?.mode, "following");
  assert.equal(snap.link?.noReading, "not-permitted");
});

test("Follow can be picked again after the hand-over", () => {
  const { f, c, clock } = following();
  f.why = "not-permitted";
  clock.t = 2000;
  c.snapshot();
  f.why = null;
  clock.t = 2100;
  f.obs = song(clock.t);
  c.command({ type: "follow" });
  assert.equal(c.snapshot().link?.mode, "following");
  assert.equal(f.active.at(-1), true);
});
