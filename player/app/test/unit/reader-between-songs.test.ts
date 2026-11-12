// Song changes (issue #51, item 4; #45 N3 and N9, #50 N4). What a music app reports for a moment
// between two songs (stopped, changing, opened, or playing with neither a title nor an artist)
// is held for one poll in all three readers: it does not show Paused, Off the list or a closed
// app for a single poll. Said twice, it is taken as it stands. Fake helpers: no process is started.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { namesNothing, readingOf, STOPPED } from "../../src/core/link/between-songs.ts";
import type { Observation } from "../../src/core/link/index.ts";
import { createController } from "../../src/main/controller.ts";
import { createWindowsMusic } from "../../src/main/readers/windows-reader.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { converterExamples } from "./fixtures.ts";
import { busNames, linuxRig, macRig, RIGS } from "./reader-rigs.ts";
import type { Rig } from "./reader-rigs.ts";
import { createHarness, otherApp, sessionLine } from "./windows-harness.ts";

const text = readFileSync(converterExamples()[0], "utf8");
const first = (JSON.parse(text) as Class).songs[0];
const VLC = "org.mpris.MediaPlayer2.vlc";

test("the mark: stopped, and playing with neither a title nor an artist", () => {
  const obs: Observation = { title: "", artist: "", lengthMs: null, trackId: null, app: "Spotify", positionMs: 0, playing: true, at: 1, seenAt: 2 };
  assert.deepEqual(STOPPED, { kind: "closed", between: true });
  assert.ok(Object.isFrozen(STOPPED));
  assert.deepEqual(readingOf(obs), { kind: "reading", obs, between: true });
  for (const named of [{ ...obs, title: "T" }, { ...obs, artist: "A" }, { ...obs, playing: false }]) {
    assert.equal(namesNothing(named), false);
    assert.deepEqual(readingOf(named), { kind: "reading", obs: named });
  }
});

/** Following, with Spotify's first reading in (a song playing), then the next poll under way. */
function playingThenNextPoll(make: () => Rig): Rig {
  const r = make();
  r.reader.setActive(true);
  r.last("read").ok(r.out.playing);
  assert.equal(r.reader.latest(0)?.playing, true);
  r.step();
  return r;
}

for (const [system, make] of RIGS) {
  for (const state of ["stopped", "empty"] as const) {
    test(`${system}: "${state}" for one poll between two songs changes nothing; for two polls it is taken as it stands`, () => {
      const r = playingThenNextPoll(make);
      const before = r.reader.latest(0);
      r.last("read").ok(r.out[state]);
      assert.equal(r.reader.latest(250), before, "the very reading it had: not closed, not nameless");
      assert.equal(r.count("names"), 0, "and no other player is asked on its account");

      r.step();
      r.last("read").ok(r.out.playing);
      assert.equal(r.reader.latest(500)?.seenAt, 500, "the next song's reading follows");
      assert.equal(r.reader.latest(500)?.playing, true);

      r.step();
      r.last("read").ok(r.out[state]);
      assert.equal(r.reader.latest(750)?.seenAt, 500, "held again at the next song change");
      r.step();
      r.last("read").ok(r.out[state]);
      const taken = r.reader.latest(1000);
      if (state === "stopped") assert.equal(taken, null, "said twice: nothing is loaded");
      else assert.deepEqual([taken?.title, taken?.artist, taken?.playing, taken?.seenAt], ["", "", true, 1000], "said twice: it plays something nameless");
    });
  }

  test(`${system}: a passing status opens the command gate like any other answer of the music app`, () => {
    const r = make();
    r.reader.setActive(true);
    r.reader.send("next");
    assert.equal(r.count("next"), 0);
    r.last("read").ok(r.out.stopped);
    assert.equal(r.count("next"), 1);
  });
}

test("Linux: while a passing status is held the other players are not asked, so one that plays is not shown for that poll", () => {
  const r = playingThenNextPoll(linuxRig);
  r.last("read").ok(r.out.stopped);
  assert.equal(r.count("names"), 0);
  assert.equal(r.reader.latest(250)?.app, "Spotify");
  // Said twice, Spotify has really stopped: now the others are asked, and one that plays is shown.
  r.step();
  r.last("read").ok(r.out.stopped);
  r.last("names").ok(busNames(VLC));
  r.last(VLC).ok(r.out.playing);
  assert.equal(r.reader.latest(500)?.app, VLC);
});

function shellOf(r: Rig): ReturnType<typeof createController> {
  const c = createController(() => r.clock.t, r.reader, r.reader);
  c.open("a.json", text);
  c.command({ type: "follow" });
  return c;
}

test("in the shell (macOS): one stopped poll at a song change stays Locked with the clock running; two are Coasting", () => {
  const r = macRig();
  const c = shellOf(r);
  const song = (seconds: number): string => `playing\tspotify:track:X\t${first.title}\t${first.artist}\t${seconds}\t${first.length_ms}\n`;
  r.last("read").ok(song(20));
  assert.equal(c.snapshot().link?.state, "Locked");
  r.step();
  r.last("read").ok("stopped\n");
  let snap = c.snapshot();
  assert.equal(snap.link?.state, "Locked", "not Coasting for a poll");
  assert.equal(snap.view?.status, "running");
  assert.equal(snap.view?.classMs, first.start_ms + 20_250, "the clock went on from the reading's own time");
  r.step();
  r.last("read").ok(song(20.5));
  assert.equal(c.snapshot().link?.state, "Locked");

  r.step();
  r.last("read").ok("stopped\n");
  r.step();
  r.last("read").ok("stopped\n");
  snap = c.snapshot();
  assert.equal(snap.link?.state, "Coasting", "Spotify really has nothing loaded");
  assert.equal(snap.view?.status, "running");
  c.stop();
});

test("in the shell (Linux): one poll of playing with empty metadata stays Locked; two are Off the list", () => {
  const r = linuxRig();
  const c = shellOf(r);
  const song = r.out.playing.replace("Spike Song A", first.title).replace('["Spike Artist"]},"xesam:autoRating', `[${JSON.stringify(first.artist)}]},"xesam:autoRating`).replace("180000000", String(first.length_ms * 1000));
  r.last("read").ok(song);
  assert.equal(c.snapshot().link?.state, "Locked");
  r.step();
  r.last("read").ok(r.out.empty);
  assert.equal(c.snapshot().link?.state, "Locked", "not Off the list for a poll");
  r.step();
  r.last("read").ok(song);
  assert.equal(c.snapshot().link?.state, "Locked");
  r.step();
  r.last("read").ok(r.out.empty);
  r.step();
  r.last("read").ok(r.out.empty);
  assert.equal(c.snapshot().link?.state, "Off the list", "it really plays something that is not in the class");
  c.stop();
});

// Windows: the helper's lines.
const line = (over: Record<string, unknown> = {}): string => sessionLine({ title: first.title, artist: first.artist, endMs: first.length_ms, positionMs: 20_000, nowUtcMs: 1_794_000_000_000, ...over });

function windowsShell(): { h: ReturnType<typeof createHarness>; c: ReturnType<typeof createController>; say: (text: string) => string | undefined } {
  const h = createHarness();
  const music = createWindowsMusic(h.deps);
  const c = createController(() => h.now, music, music);
  c.open("a.json", text);
  c.command({ type: "follow" });
  h.child.line(line());
  assert.equal(c.snapshot().link?.state, "Locked");
  const say = (text: string): string | undefined => {
    h.advance(250);
    h.child.line(text);
    return c.snapshot().link?.state;
  };
  return { h, c, say };
}

for (const status of ["Changing", "Stopped", "Opened"]) {
  test(`Windows: Spotify "${status}" for one poll stays Locked with the clock running; for two polls it is Paused`, () => {
    const { c, say } = windowsShell();
    assert.equal(say(line({ status })), "Locked", "not Paused for a poll");
    assert.equal(c.snapshot().view?.status, "running");
    assert.equal(c.snapshot().view?.classMs, first.start_ms + 20_250);
    assert.equal(say(line({ positionMs: 500, title: first.title })), "Locked");
    assert.equal(say(line({ status })), "Locked", "held again at the next change");
    assert.equal(say(line({ status })), "Paused", "said twice: it is taken as before, as not playing");
    assert.equal(c.snapshot().view?.status, "paused");
  });

  test(`Windows: another app playing while Spotify is "${status}" for one poll is not Off the list; for two polls it is`, () => {
    const { c, say } = windowsShell();
    assert.equal(say(otherApp("Chrome", status)), "Locked", "not Off the list for a poll");
    assert.equal(c.snapshot().link?.songIndex, 0);
    assert.equal(say(line({ positionMs: 500 })), "Locked");
    assert.equal(say(otherApp("Chrome", status)), "Locked");
    assert.equal(say(otherApp("Chrome", status)), "Off the list");
    assert.equal(c.snapshot().view?.status, "running");
  });
}

test("Windows: playing with neither a title nor an artist for one poll stays Locked; for two polls it is Off the list", () => {
  const { say } = windowsShell();
  assert.equal(say(line({ title: "", artist: null })), "Locked");
  assert.equal(say(line({ positionMs: 500 })), "Locked");
  assert.equal(say(line({ title: "", artist: "" })), "Locked");
  assert.equal(say(line({ title: "", artist: "" })), "Off the list");
});

test("Windows: paused, another app while Spotify is paused, and no session are not passing statuses: they show at once", () => {
  assert.equal(windowsShell().say(line({ status: "Paused" })), "Paused");
  assert.equal(windowsShell().say(otherApp("Chrome", "Paused")), "Off the list");
  assert.equal(windowsShell().say(otherApp("Chrome", "")), "Off the list");
  assert.equal(windowsShell().say(line({ status: "Closed" })), "Paused", "Closed is taken as before");
});
