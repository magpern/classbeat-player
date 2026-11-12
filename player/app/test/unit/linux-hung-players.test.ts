// Other players that hang or fail (issue #51, item 3; #50 N1). Spotify's own reading is stored
// as soon as its call answers, before any other player is asked, and Spotify goes on being
// polled while the others are asked. A player that hangs, fails or answers garbage is only "not
// known to play": it never makes Spotify's reading late, stale or an error. A fake execFile:
// nothing here starts a process or talks to a D-Bus.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_LINK_CONFIG, isCurrent } from "../../src/core/link/index.ts";
import { createController } from "../../src/main/controller.ts";
import { GIVE_UP_MS } from "../../src/main/linux-reader.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { converterExamples } from "./fixtures.ts";
import { busNames, FAILED, linuxRig } from "./reader-rigs.ts";

const HUNG = ["a", "b", "c", "d"].map((x) => `org.mpris.MediaPlayer2.${x}`);
const VLC = "org.mpris.MediaPlayer2.vlc";

test("Spotify's paused reading is stored when its call answers, before the bus or any player is asked", () => {
  const r = linuxRig();
  r.clock.t = 1000;
  r.reader.setActive(true);
  r.clock.t = 1040;
  r.last("read").ok(r.out.paused);
  assert.deepEqual(r.calls.map((c) => c.what), ["read", "names"], "the others are asked after it");
  assert.deepEqual([r.reader.latest(1040)?.app, r.reader.latest(1040)?.playing, r.reader.latest(1040)?.at, r.reader.latest(1040)?.seenAt], ["Spotify", false, 1020, 1040]);
});

test("four players that never answer: Spotify is polled on time and its paused reading never goes stale", () => {
  const r = linuxRig();
  r.reader.setActive(true);
  r.last("read").ok(r.out.paused);
  r.last("names").ok(busNames(...HUNG));
  assert.equal(r.last(HUNG[0]).what, HUNG[0], "the first player is asked, and never answers");
  // 30 s of polls: Spotify answers each one at once; no other player ever does.
  for (let i = 0; i < 120; i++) {
    r.step();
    assert.equal(r.count("read"), i + 2, "Spotify is asked at every poll");
    r.last("read").ok(r.out.paused);
    const obs = r.reader.latest(r.clock.t);
    assert.deepEqual([obs?.app, obs?.playing, obs?.seenAt], ["Spotify", false, r.clock.t], "its newest reading, dated in its own call");
    assert.ok(obs && isCurrent(obs, r.clock.t + 249, DEFAULT_LINK_CONFIG.staleMs));
  }
  assert.equal(r.count("read"), 121);
  // A round that got no answer is given up, and the next one starts with the bus's names again.
  assert.equal(r.count("names"), 1 + Math.floor(30_000 / (Math.ceil(GIVE_UP_MS / 250) * 250)));
  assert.equal(r.count(HUNG[1]), 0, "a player is asked only when the one before it has answered");
});

test("players that fail, are killed at the timeout or answer garbage are passed over; one that plays after them is found", () => {
  const r = linuxRig();
  r.reader.setActive(true);
  r.last("read").ok(r.out.paused);
  r.last("names").ok(busNames(HUNG[0], HUNG[1], HUNG[2], VLC));
  r.last(HUNG[0]).fail(FAILED());
  assert.equal(r.reader.latest(0)?.app, "Spotify", "a failure on another player is not Spotify's failure");
  r.clock.t = 700;
  r.last(HUNG[1]).fail(Object.assign(new Error("killed"), { killed: true, signal: "SIGKILL" }));
  r.last(HUNG[2]).ok("garbage\n");
  assert.equal(r.reader.latest(700)?.app, "Spotify");
  r.clock.t = 740;
  r.last(VLC).ok(r.out.playing);
  assert.deepEqual([r.reader.latest(740)?.app, r.reader.latest(740)?.at, r.reader.latest(740)?.seenAt], [VLC, 720, 740], "the other player, dated in its own call");
});

test("a slow round is not given up while its calls keep answering, and only one round runs at a time", () => {
  const r = linuxRig();
  r.reader.setActive(true);
  r.last("read").ok(r.out.paused);
  r.last("names").ok(busNames(...HUNG));
  // Each player takes 1 s to fail: longer in all than the give-up time of one call.
  for (const name of HUNG) {
    for (let i = 0; i < 4; i++) {
      r.step();
      r.last("read").ok(r.out.paused);
    }
    assert.equal(r.count("names"), 1, "no second round beside the first");
    r.last(name).fail(FAILED());
  }
  assert.deepEqual(HUNG.map((name) => r.count(name)), [1, 1, 1, 1]);
  r.step();
  r.last("read").ok(r.out.paused);
  assert.equal(r.count("names"), 2, "the round ended: the next poll starts a new one");
});

test("a late answer from a round that was given up, or ended by Spotify playing, or by Follow off, is dropped", () => {
  const r = linuxRig();
  r.reader.setActive(true);
  r.last("read").ok(r.out.paused);
  r.last("names").ok(busNames(VLC));
  const lost = r.last(VLC);
  for (let i = 0; i < 6; i++) {
    r.step();
    r.last("read").ok(r.out.paused);
  }
  assert.equal(r.count("names"), 2, "the round was given up and a new one began");
  lost.ok(r.out.playing);
  assert.equal(r.reader.latest(r.clock.t)?.app, "Spotify", "the given-up round's answer is not a reading");

  r.last("names").ok(busNames(VLC));
  const pending = r.last(VLC);
  r.step();
  r.last("read").ok(r.out.playing);
  pending.ok(r.out.playing);
  assert.equal(r.reader.latest(r.clock.t)?.app, "Spotify", "Spotify plays: the round's answer is dropped");

  r.step();
  r.last("read").ok(r.out.paused);
  r.last("names").ok(busNames(VLC));
  r.reader.setActive(false);
  r.last(VLC).ok(r.out.playing);
  assert.equal(r.reader.latest(r.clock.t), null);
  r.reader.setActive(true);
  assert.equal(r.reader.latest(r.clock.t), null, "following again starts from nothing, the other player included");
});

test("another player that keeps playing stays in front of Spotify's paused reading while the next round is under way", () => {
  const r = linuxRig();
  r.reader.setActive(true);
  r.last("read").ok(r.out.paused);
  r.last("names").ok(busNames(VLC));
  r.last(VLC).ok(r.out.playing);
  assert.equal(r.reader.latest(0)?.app, VLC);
  r.step();
  r.last("read").ok(r.out.paused);
  assert.equal(r.reader.latest(250)?.app, VLC, "not Spotify's paused reading for the length of a round");
  r.last("names").ok(busNames(VLC));
  r.last(VLC).ok(r.out.paused);
  assert.equal(r.reader.latest(250)?.app, "Spotify", "the round found nobody playing");
});

test("in the shell: Spotify paused beside four players that never answer stays Paused, with the clock stopped", () => {
  const text = readFileSync(converterExamples()[0], "utf8");
  const first = (JSON.parse(text) as Class).songs[0];
  const r = linuxRig();
  const song = r.out.playing.replace("Spike Song A", first.title).replace('["Spike Artist"]},"xesam:autoRating', `[${JSON.stringify(first.artist)}]},"xesam:autoRating`).replace("180000000", String(first.length_ms * 1000));
  const c = createController(() => r.clock.t, r.reader, r.reader);
  c.open("a.json", text);
  c.command({ type: "follow" });
  r.last("read").ok(song);
  assert.equal(c.snapshot().link?.state, "Locked");
  const paused = song.replace('"Playing"', '"Paused"');
  r.step();
  r.last("read").ok(paused);
  r.last("names").ok(busNames(...HUNG));
  const at = c.snapshot().view?.classMs;
  for (let i = 0; i < 60; i++) {
    r.step();
    r.last("read").ok(paused);
    const snap = c.snapshot();
    assert.equal(snap.link?.state, "Paused", `never Coasting (poll ${i})`);
    assert.equal(snap.view?.status, "paused");
    assert.equal(snap.view?.classMs, at, "the class clock stands still with the music");
  }
  c.stop();
});
