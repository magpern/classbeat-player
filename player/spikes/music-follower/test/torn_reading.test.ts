import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClassFollower } from "../src/core/follower.js";
import { plan, track } from "./helpers.js";

const rd = (t: number, tr: ReturnType<typeof track>, positionMs: number) => ({
  trackId: tr.trackId,
  title: tr.title,
  artist: tr.artist,
  durationMs: tr.durationMs,
  positionMs,
  state: "playing" as const,
  readAtMs: t,
  polledAtMs: t,
  source: "test",
});
// Song 1's id, title and artist with song 2's length: what one torn osascript read returns.
const tornTrack = { ...track(0), durationMs: plan.songs[1]!.durationMs };

function warm(f: ClassFollower): void {
  for (let t = 0; t <= 100_000; t += 250) f.step(t, rd(t, track(0), t));
}

describe("torn reading at a song change", () => {
  it("holds the torn reading, then song_change with a continuous class clock", () => {
    const f = new ClassFollower(plan);
    warm(f);
    const before = f.step(100_250, rd(100_250, track(0), 100_250));
    const held = f.step(100_500, rd(100_500, tornTrack, 10));
    assert.equal(held.held, true);
    assert.equal(held.event, "torn_hold");
    assert.notEqual(held.event, "seek");
    assert.ok(Math.abs(held.classTimeMs - before.classTimeMs) <= 500);
    const next = f.step(100_750, rd(100_750, track(1), 260));
    assert.equal(next.event, "song_change");
    assert.equal(next.songIndex, 1);
    assert.equal(next.held, false);
  });

  it("applies a confirmed seek one poll late", () => {
    const f = new ClassFollower(plan);
    warm(f);
    assert.equal(f.step(100_250, rd(100_250, tornTrack, 10)).held, true);
    const d = f.step(100_500, rd(100_500, track(0), 260));
    assert.equal(d.event, "seek");
    assert.equal(d.held, false);
    assert.equal(d.classTimeMs, 260);
  });

  it("applies a seek to the start of the same song at once when the length is unchanged", () => {
    const f = new ClassFollower(plan);
    warm(f);
    const d = f.step(100_250, rd(100_250, track(0), 10));
    assert.equal(d.event, "seek");
    assert.equal(d.held, false);
    assert.equal(d.classTimeMs, 10);
  });

  it("holds at most one poll in a row", () => {
    const f = new ClassFollower(plan);
    warm(f);
    assert.equal(f.step(100_250, rd(100_250, tornTrack, 10)).held, true);
    const second = f.step(100_500, rd(100_500, tornTrack, 260));
    assert.equal(second.held, false);
    assert.equal(second.event, "seek");
  });
});
