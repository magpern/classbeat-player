import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { at, plan, play, simulate, track } from "./helpers.js";

describe("class plan", () => {
  it("gives each song a window ending at the next song's start (9 s crossfade)", () => {
    assert.equal(plan.songs[1]!.startMs, 171_000);
    assert.equal(plan.songs[0]!.endMs, 171_000);
    assert.equal(plan.songs[4]!.endMs, plan.totalMs);
  });
});

describe("song change with overlap", () => {
  for (const crossfade of [0, 5000, 9000, 12000]) {
    it(`never moves backwards and detects the change within 1 s (real crossfade ${crossfade / 1000} s)`, () => {
      const change = 180_000 - crossfade;
      const { ds } = simulate({ events: [play(0, 0), { at: change, track: track(1), positionMs: 0 }] }, 200_000);
      for (let i = 1; i < ds.length; i++) assert.ok(ds[i]!.classTimeMs >= ds[i - 1]!.classTimeMs, `backwards at ${ds[i]!.nowMs}`);
      const first = ds.find((d) => d.songIndex === 1)!;
      assert.ok(first.nowMs - change <= 1000);
      assert.equal(first.event, "song_change");
      const later = at(ds, change + 5000);
      assert.equal(later.state, "Locked");
      assert.equal(later.classTimeMs, 171_000 + 5000);
    });
  }

  it("holds at the end of the window when the song plays on (crossfade off)", () => {
    const { ds } = simulate({ events: [play(0, 0), { at: 180_000, track: track(1), positionMs: 0 }] }, 185_000);
    const held = at(ds, 175_000);
    assert.equal(held.classTimeMs, 171_000);
    assert.equal(held.held, true);
    assert.equal(at(ds, 179_750).classTimeMs, 171_000);
  });

  it("jumps forward when the incoming song arrives early (longer crossfade)", () => {
    const { ds } = simulate({ events: [play(0, 0), { at: 160_000, track: track(1), positionMs: 0 }] }, 165_000);
    assert.ok(at(ds, 159_750).classTimeMs < 160_000);
    assert.equal(at(ds, 160_000).classTimeMs, 171_000);
  });
});

describe("pause and resume", () => {
  it("stops the clock while paused and continues from the same place", () => {
    const { ds } = simulate({ events: [play(0, 0), { at: 60_000, state: "paused" }, { at: 80_000, state: "playing" }] }, 90_000);
    assert.equal(at(ds, 70_000).state, "Paused");
    assert.equal(at(ds, 60_250).classTimeMs, 60_000);
    assert.equal(at(ds, 79_750).classTimeMs, 60_000);
    const resumed = at(ds, 80_000);
    assert.equal(resumed.state, "Locked");
    assert.equal(resumed.event, "resume");
    assert.equal(at(ds, 85_000).classTimeMs, 65_000);
  });
});

describe("seek, next and previous", () => {
  it("is locked again at the right place within one poll after a seek, forward and back", () => {
    const { ds } = simulate({ events: [play(0, 0), { at: 30_000, positionMs: 120_000 }, { at: 100_000, positionMs: 10_000 }] }, 110_000);
    const fwd = at(ds, 30_000);
    assert.equal(fwd.classTimeMs, 120_000);
    assert.equal(fwd.event, "seek");
    const back = at(ds, 100_000);
    assert.equal(back.classTimeMs, 10_000);
    assert.equal(back.event, "seek");
    assert.equal(back.state, "Locked");
  });

  it("follows next and previous, and moves backwards only on purpose", () => {
    const { ds } = simulate({ events: [play(0, 0), { at: 50_000, track: track(2), positionMs: 0 }, { at: 70_000, track: track(0), positionMs: 0 }] }, 80_000);
    assert.equal(at(ds, 50_000).classTimeMs, plan.songs[2]!.startMs);
    assert.equal(at(ds, 50_000).event, "song_change");
    assert.equal(at(ds, 70_000).classTimeMs, 0);
    assert.equal(at(ds, 70_000).songIndex, 0);
  });
});

describe("the same recording twice", () => {
  it("reports a cold start on a repeated song as ambiguous, not guessed silently", () => {
    const { ds, follower } = simulate({ events: [play(1, 0, 30_000)] }, 2000);
    const d = ds[0]!;
    assert.equal(d.state, "Ambiguous");
    assert.deepEqual(d.candidates, [1, 3]);
    follower.pickOccurrence(3);
    const after = follower.step(2250, { ...simulateReading(2250) });
    assert.equal(after.state, "Locked");
    assert.equal(after.songIndex, 3);
    assert.equal(after.classTimeMs, plan.songs[3]!.startMs + 32_250);
  });

  it("chooses the right occurrence from the order during a class", () => {
    const events = [play(0, 0), play(1, 171_000), play(2, 362_000), play(3, 543_000)];
    const { ds } = simulate({ events }, 550_000, { stepMs: 500 });
    assert.equal(at(ds, 200_000).songIndex, 1);
    assert.equal(at(ds, 200_000).state, "Locked");
    const d = at(ds, 550_000);
    assert.equal(d.songIndex, 3);
    assert.equal(d.state, "Locked");
    assert.deepEqual(d.candidates, [1, 3]);
    assert.equal(d.classTimeMs, 543_000 + 7000);
  });
});

function simulateReading(t: number) {
  return {
    ...track(1),
    positionMs: 32_250,
    state: "playing" as const,
    readAtMs: t,
    polledAtMs: t,
    source: "fake",
  };
}

describe("a song that is not in the class", () => {
  it("is off the list at once, the clock keeps running, and locks again on return", () => {
    const ad = { trackId: "spotify:ad:1", title: "Advertisement", artist: "Spotify" };
    const { ds } = simulate({ events: [play(0, 0), { at: 60_000, track: ad, positionMs: 0 }, { at: 80_000, track: track(0), positionMs: 80_000 }] }, 90_000);
    const off = at(ds, 60_000);
    assert.equal(off.state, "Off the list");
    assert.equal(off.event, "off_list");
    assert.ok(at(ds, 79_750).classTimeMs > 79_000);
    const back = at(ds, 80_000);
    assert.equal(back.state, "Locked");
    assert.equal(back.event, "relock");
    assert.ok(Math.abs(back.classTimeMs - 80_000) <= 1000);
    assert.equal(back.announce, null);
  });
});

describe("stale readings and lost readings", () => {
  it("enters coasting within 3 s of the last fresh reading and leaves it at the next fresh one", () => {
    const { ds } = simulate({ events: [play(0, 0)], frozen: [[60_000, 70_000]] }, 75_000);
    const coast = ds.find((d) => d.state === "Coasting")!;
    assert.ok(coast.nowMs - 60_000 <= 3000, `coasting at ${coast.nowMs}`);
    assert.ok(ds.filter((d) => d.nowMs > 60_000 && d.nowMs < 70_000 && d.nowMs - 60_000 > 3000).every((d) => d.state === "Coasting"));
    const back = at(ds, 70_000);
    assert.equal(back.state, "Locked");
    assert.equal(back.event, "relock");
    assert.ok(Math.abs(back.classTimeMs - 70_000) <= 1000);
  });

  it("coasts when the music app closes and restarts, then goes to where the music is", () => {
    const { ds } = simulate({ events: [play(0, 0), { at: 70_000, positionMs: 0, state: "paused" }], lost: [[60_000, 70_000]] }, 75_000);
    assert.ok(ds.find((d) => d.state === "Coasting")!.nowMs - 60_000 <= 3000);
    const back = at(ds, 70_000);
    assert.equal(back.state, "Paused");
    assert.equal(back.classTimeMs, 0);
    assert.match(back.announce ?? "", /resynced, \d+ s back/);
  });

  it("30 s lost while paused: coasts, goes back to the music, announces, and undo works", () => {
    const { ds, follower } = simulate({ events: [play(0, 0), { at: 50_000, state: "paused" }], lost: [[50_250, 80_000]] }, 81_000);
    assert.equal(at(ds, 49_750).state, "Locked");
    const coast = ds.find((d) => d.state === "Coasting")!;
    assert.ok(coast.nowMs - 50_250 <= 3000);
    const before = at(ds, 79_750).classTimeMs;
    assert.ok(before > 75_000);
    const back = at(ds, 80_000);
    assert.equal(back.classTimeMs, 50_000);
    assert.equal(back.state, "Paused");
    assert.match(back.announce ?? "", /resynced, 2[78] s back/);
    const undone = follower.undo(81_000);
    assert.equal(undone.state, "Manual");
    assert.ok(Math.abs(undone.classTimeMs - before) <= 1500);
  });

  it("30 s lost while playing: back in step within the interval target, no announcement", () => {
    const { ds } = simulate({ events: [play(0, 0)], lost: [[60_000, 90_000]] }, 92_000);
    const back = at(ds, 90_000);
    assert.equal(back.state, "Locked");
    assert.ok(Math.abs(back.classTimeMs - 90_000) <= 1000);
    assert.equal(back.announce, null);
  });
});

describe("the clock never moves backwards by itself", () => {
  for (const crossfade of [0, 9000, 12000]) {
    it(`with ±200 ms reading jitter across two song changes (crossfade ${crossfade / 1000} s)`, () => {
      const c1 = 180_000 - crossfade;
      const c2 = c1 + 200_000 - crossfade;
      const { ds } = simulate({ events: [play(0, 0), play(1, c1), play(2, c2)] }, c2 + 20_000, { noiseMs: 200 });
      for (let i = 1; i < ds.length; i++) assert.ok(ds[i]!.classTimeMs >= ds[i - 1]!.classTimeMs, `backwards at ${ds[i]!.nowMs}`);
    });
  }
});
