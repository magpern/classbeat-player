import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPlan } from "../src/core/class_plan.js";
import { ClassFollower } from "../src/core/follower.js";
import { durationMatch, matchDetail } from "../src/core/match.js";
import type { Reading } from "../src/core/types.js";

const REAL = 336840; // Mr. Vain, crossfade off (owner's Mac, 2026-11-14)

const planWith = (crossfadeMs: number) =>
  buildPlan({
    crossfadeMs,
    songs: [
      { trackId: "spotify:track:AAA", title: "Mr. Vain", artist: "Culture Beat", durationMs: REAL },
      { trackId: "spotify:track:BBB", title: "Other", artist: "Someone", durationMs: 200000 },
    ],
  });

// A relinked track: a different id, so only title, artist and length can match it.
const reading = (durationMs: number | null, trackId: string | null = "spotify:track:RELINKED"): Reading => ({
  trackId,
  title: "Mr. Vain",
  artist: "Culture Beat",
  positionMs: 1000,
  durationMs,
  state: "playing",
  readAtMs: 0,
  polledAtMs: 0,
  source: "test",
});

describe("duration match with crossfade", () => {
  const table: { name: string; crossfade: number; reported: number; want: number[]; by: string | null }[] = [
    { name: "crossfade 0, real length", crossfade: 0, reported: REAL, want: [0], by: "title_duration" },
    { name: "crossfade 0, real length within tolerance", crossfade: 0, reported: REAL - 2500, want: [0], by: "title_duration" },
    { name: "crossfade 0, 10 s short is rejected", crossfade: 0, reported: REAL - 10000, want: [], by: null },
    { name: "crossfade 10000, real length", crossfade: 10000, reported: REAL, want: [0], by: "title_duration" },
    { name: "crossfade 10000, length minus crossfade", crossfade: 10000, reported: REAL - 10000, want: [0], by: "title_duration_minus_crossfade" },
    { name: "crossfade 10000, minus crossfade within tolerance", crossfade: 10000, reported: REAL - 10000 + 2500, want: [0], by: "title_duration_minus_crossfade" },
    { name: "crossfade 10000, outside both", crossfade: 10000, reported: REAL - 5000, want: [], by: null },
    { name: "crossfade 10000, minus a larger undeclared amount", crossfade: 10000, reported: REAL - 12501, want: [], by: null },
  ];
  for (const t of table) {
    it(t.name, () => {
      const m = matchDetail(planWith(t.crossfade), reading(t.reported));
      assert.deepEqual(m.indexes, t.want);
      assert.equal(m.matchedBy, t.by);
    });
  }

  it("rejects length minus a crossfade the class file does not declare", () => {
    assert.deepEqual(matchDetail(planWith(0), reading(REAL - 10000)).indexes, []);
    assert.deepEqual(matchDetail(planWith(5000), reading(REAL - 10000)).indexes, []);
  });

  it("durationMatch is the pure rule", () => {
    assert.equal(durationMatch(REAL, REAL, 10000), "title_duration");
    assert.equal(durationMatch(REAL - 10000, REAL, 10000), "title_duration_minus_crossfade");
    assert.equal(durationMatch(REAL - 10000, REAL, 0), null);
  });

  it("the trackId path is unchanged: any length matches, matchedBy is trackId", () => {
    const m = matchDetail(planWith(10000), reading(1234, "spotify:track:AAA"));
    assert.deepEqual(m.indexes, [0]);
    assert.equal(m.matchedBy, "trackId");
  });

  it("a reading without a length still matches by title and artist", () => {
    const m = matchDetail(planWith(10000), reading(null));
    assert.deepEqual([m.indexes, m.matchedBy], [[0], "title_no_duration"]);
  });

  it("the decision carries matchedBy, and it is null when off the list", () => {
    const f = new ClassFollower(planWith(10000));
    assert.equal(f.step(0, reading(REAL - 10000)).matchedBy, "title_duration_minus_crossfade");
    assert.equal(f.step(250, reading(REAL - 5000)).state, "Off the list");
    assert.equal(f.step(250, reading(REAL - 5000)).matchedBy, null);
  });
});
