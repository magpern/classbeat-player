// A reading whose time cannot be told (ADR 0001, rule 8): the Linux reader dates a reading
// inside its own call and never "now". A fake execFile: nothing here starts a process.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isCurrent } from "../../src/core/link/index.ts";
import { LINUX_CALLS } from "../../src/core/link/linux-calls.ts";
import { otherPlayerReading } from "../../src/core/link/linux-parse.ts";
import { bus, PAUSED, PLAYING, VLC } from "./linux-bus.ts";

test("a reading is dated inside its own call, and one of another player inside that player's call", () => {
  const b = bus({ spotify: PAUSED, players: { [VLC]: PLAYING } });
  b.clock.t = 1000;
  b.clock.step = 40; // every call takes 40 ms
  b.linux.setActive(true);
  // Spotify 1000..1040, the names 1040..1080, the other player 1080..1120.
  assert.deepEqual([b.linux.latest(0)?.at, b.linux.latest(0)?.seenAt], [1100, 1120]);
  b.state.players = {};
  b.poll();
  assert.deepEqual([b.linux.latest(0)?.app, b.linux.latest(0)?.at, b.linux.latest(0)?.seenAt], ["Spotify", 1140, 1160]);
});

for (const [label, step] of [
  ["runs backwards", -40],
  ["is not a number", Number.NaN],
  ["is infinite", Number.POSITIVE_INFINITY],
] as const) {
  test(`a clock that ${label} across the call: no reading is made of it, and the last one ages (rule 8)`, () => {
    const b = bus({ spotify: PLAYING });
    b.clock.t = 1000;
    b.linux.setActive(true);
    const good = b.linux.latest(1000);
    assert.equal(good?.seenAt, 1000);
    assert.ok(good);

    b.state.spotify = PLAYING.replace("12500000", "99000000");
    b.state.players = { [VLC]: PLAYING };
    b.clock.t = 1250;
    b.clock.step = step;
    b.poll();
    b.clock.t = 1300;
    b.clock.step = 0;
    assert.equal(b.linux.latest(1300), good, "neither Spotify's nor the other player's answer became a reading");
    assert.equal(isCurrent(good, 3500, 2500), true);
    assert.equal(isCurrent(good, 3501, 2500), false, "it goes stale by its own time");
    b.poll();
    assert.equal(b.linux.latest(1300)?.positionMs, 99_000, "and a call with a usable time is a reading again");
  });

  test(`a clock that ${label} across the very first call: no reading at all, and no command`, () => {
    const b = bus({ spotify: PLAYING });
    b.clock.step = step;
    b.linux.setActive(true);
    assert.equal(b.linux.latest(0), null);
    b.linux.send("play");
    assert.ok(!b.runs.includes(LINUX_CALLS.play));
  });
}

test("a reading of another player holds its name and its times, and nothing of what it plays", () => {
  assert.deepEqual(otherPlayerReading(VLC, 10, 20), { title: "", artist: "", lengthMs: null, trackId: null, app: VLC, positionMs: 0, playing: true, at: 10, seenAt: 20 });
});
