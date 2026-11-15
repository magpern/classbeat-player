// Looks and phrases (scope 2), beat levels (S8, scope 4) and colour (S5, scope 5).
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIRST_PHRASE, beatsAt, phraseAt, phraseOfIndex } from "../src/beat-grid.ts";
import { ALLOWED, beatLevel, patternCountRuns } from "../src/beat-level.ts";
import type { LinkStateName } from "../src/beat-level.ts";
import { ANTICIPATION_MS, rigColours } from "../src/colour.ts";
import { sceneFrame } from "../src/frame.ts";
import { LOOKS, lookForSong } from "../src/looks.ts";

test("a song's look is its order in the class: deterministic, and neighbours differ", () => {
  const first = Array.from({ length: 12 }, (_, i) => lookForSong(i));
  assert.deepEqual(first, Array.from({ length: 12 }, (_, i) => lookForSong(i)));
  assert.deepEqual(new Set(first.slice(0, 5)), new Set(LOOKS));
  first.slice(1).forEach((l, i) => assert.notEqual(l, first[i]));
  assert.throws(() => lookForSong(-1), RangeError);
});

test("the phrase changes every 8 bars from the anchors and alternates mirroring", () => {
  const anchors = [{ at_ms: 1_000, bpm: 120 }]; // a bar is 2 s, a phrase 16 s
  assert.equal(phraseAt(anchors, 1_000).index, 0);
  assert.equal(phraseAt(anchors, 16_999).index, 0);
  assert.equal(phraseAt(anchors, 17_000).index, 1);
  assert.equal(phraseAt(anchors, 17_000).mirrored, true);
  assert.equal(phraseOfIndex(2).leadHalf, 1);
  assert.equal(phraseAt(undefined, 50_000).index, 0); // no anchors, no grid, nothing guessed
  assert.equal(beatsAt(undefined, 5), null);
  // A tempo change at an anchor: 30 s at 60 bpm, then 120 bpm.
  const two = [{ at_ms: 0, bpm: 60 }, { at_ms: 30_000, bpm: 120 }];
  assert.equal(beatsAt(two, 30_000), 30);
  assert.equal(beatsAt(two, 31_000), 32);
});

const song = { bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }] };
test("S8: the level comes from the link, bpm and anchors", () => {
  assert.equal(beatLevel({ state: "Locked" }, song), "Beat");
  assert.equal(beatLevel({ state: "Locked" }, { bpm: 120 }), "Tempo only");
  assert.equal(beatLevel({ state: "Locked" }, { bpm: 120, anchors: [] }), "Tempo only");
  assert.equal(beatLevel({ state: "Locked" }, { anchors: song.anchors }), "None"); // no bpm
  assert.equal(beatLevel({ state: "Locked" }, {}), "None");
  assert.equal(beatLevel({ state: "Locked" }, null), "None");
  assert.equal(beatLevel({ state: "Locked", held: true }, song), "None");
  for (const state of ["Paused", "Coasting", "Off the list", "Ambiguous", "Manual"] as LinkStateName[]) {
    assert.equal(beatLevel({ state }, song), "None", state);
  }
});

test("S8: what each level allows", () => {
  const b = ALLOWED.Beat;
  assert.deepEqual([b.beatLift, b.wallChase, b.phrase, b.barsLine, b.patternAccent, b.tempoPulse], [true, true, true, true, true, 0]);
  const t = ALLOWED["Tempo only"];
  assert.deepEqual([t.beatLift, t.wallChase, t.phrase, t.barsLine, t.patternAccent, t.tempoPulse], [false, false, false, false, false, 0.12]);
  const n = ALLOWED.None;
  assert.deepEqual([n.beatLift, n.wallChase, n.phrase, n.barsLine, n.patternAccent, n.tempoPulse], [false, false, false, false, false, 0]);
  assert.ok(patternCountRuns("Beat", "interval_start") && patternCountRuns("Beat", "next_downbeat"));
  assert.ok(patternCountRuns("Tempo only", "interval_start"));
  assert.ok(!patternCountRuns("Tempo only", "next_downbeat")); // "count from the music"
  assert.ok(!patternCountRuns("None", "interval_start"));
});

test("S8: without the Beat level the frame has no phrase (mirroring) even deep into the song", () => {
  const cls = { songs: [{ bpm: 120 }], intervals: [{ startMs: 0, zone: 3 }], endMs: 60_000 };
  const f = sceneFrame({ cls, classMs: 20_000, songIndex: 0, songPosMs: 20_000, phaseDeg: 0, link: { state: "Locked" } });
  assert.equal(f.level, "Tempo only");
  assert.equal(f.phrase.mirrored, false);
});

test("S8: the frame's phrase runs only at the Beat level, even for a song with anchors deep in an odd phrase", () => {
  const cls = { songs: [{ bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }] }], intervals: [{ startMs: 0, zone: 3 }], endMs: 120_000 };
  const at = { cls, classMs: 20_000, songIndex: 0, songPosMs: 20_000, phaseDeg: 40 }; // phrase 1: mirrored
  const locked = sceneFrame({ ...at, link: { state: "Locked" } });
  assert.equal(locked.level, "Beat");
  assert.equal(locked.phrase.mirrored, true);
  assert.equal(sceneFrame({ ...at, songPosMs: 40_000, link: { state: "Locked" } }).phrase.leadHalf, 1); // phrase 2: lead half swaps
  const links = [
    { state: "Locked" as const, held: true },
    ...(["Paused", "Coasting", "Off the list", "Ambiguous", "Manual"] as LinkStateName[]).map((state) => ({ state })),
  ];
  for (const link of links) {
    const first = sceneFrame({ ...at, songPosMs: 0, link });
    for (const songPosMs of [20_000, 40_000]) {
      const f = sceneFrame({ ...at, songPosMs, link });
      assert.equal(f.level, "None", link.state);
      assert.deepEqual(f.phrase, FIRST_PHRASE, link.state);
      assert.deepEqual(f.directions, first.directions); // no mirroring, no lead-half swap
    }
    assert.notDeepEqual(sceneFrame({ ...at, link }).directions, locked.directions);
  }
});

test("S5: current zone, next zone in the last 10 s, white; never another hue", () => {
  assert.deepEqual(rigColours(3, 5, 30_000), { front: { kind: "zone", zone: 3 }, back: { kind: "zone", zone: 3 }, wipe: 0 });
  assert.deepEqual(rigColours(3, null, 5_000), { front: { kind: "zone", zone: 3 }, back: { kind: "zone", zone: 3 }, wipe: 0 });
  const a = rigColours(3, 5, ANTICIPATION_MS);
  assert.deepEqual([a.front, a.back, a.wipe], [{ kind: "zone", zone: 3 }, { kind: "zone", zone: 5 }, 0]);
  const half = rigColours(3, 5, 5_000);
  assert.deepEqual([half.front, half.back, half.wipe], [{ kind: "zone", zone: 3 }, { kind: "zone", zone: 5 }, 0.5]);
  assert.equal(rigColours(3, 5, 0).back.kind, "zone");
  assert.deepEqual(rigColours(3, 5, 0).back, { kind: "zone", zone: 3 });
  // Only zone numbers 1..7 make a hue: a heart-rate zone or any other number cannot.
  for (const bad of [0, 8, 2.5, NaN]) assert.throws(() => rigColours(bad, null, null), RangeError);
  assert.throws(() => rigColours(3, 9, 1_000), RangeError);
  for (const ms of [null, 0, 500, 9_000, 10_000, 60_000]) {
    for (const h of [rigColours(4, 6, ms).front, rigColours(4, 6, ms).back]) {
      assert.ok(h.kind === "white" || (h.kind === "zone" && (h.zone === 4 || h.zone === 6)));
    }
  }
});
