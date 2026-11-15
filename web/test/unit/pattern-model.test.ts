// The position pattern in the Position metric, the next row's cue (docs/design/room-2d.md, "The
// follow-up to the scene"): what the adapter decides from the interval, the song, the link and the
// player's count. The count is only ever the player's; the screen never guesses one.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toRoomModel } from "../../src/room/adapter.ts";
import { linkAt } from "../../src/fixtures/build.ts";
import { FIXTURES } from "../../src/fixtures/index.ts";
import type { Class, PatternInput, RoomInput } from "../../src/room/input.ts";
import { NOTE_NO_COUNT, NOTE_NO_TEMPO, NOTE_STARTS_SOON, patternWords, sideWord } from "../../src/room/pattern-model.ts";

const position = (input: RoomInput) => toRoomModel(input).metrics.find((m) => m.label === "Position");
const SNAP: PatternInput = { position: "standing", beat: 3, beatsLeft: 6, nextPosition: "seated" };

/** `input` with the link in another state (the count stays what the player sent). */
function withLink(input: RoomInput, state: Parameters<typeof linkAt>[1], patch: Parameters<typeof linkAt>[2] = {}): RoomInput {
  const view = input.view;
  assert.ok(view);
  return { ...input, link: linkAt(view, state, patch) };
}

describe("the Position metric in a pattern interval", () => {
  it("shows the side and the beats left on it: UP is standing, DOWN is seated", () => {
    const m = position(FIXTURES.pattern);
    assert.deepEqual(m?.pattern, { kind: "count", side: "UP", count: "6" });
    assert.equal(m?.value, "UP 6");
    assert.deepEqual(position(FIXTURES["pattern-down"])?.pattern, { kind: "count", side: "DOWN", count: "12" });
    assert.deepEqual([sideWord("standing"), sideWord("seated")], ["UP", "DOWN"]);
  });

  it("steps down with the player's count, to one, with no guess of the screen's own", () => {
    for (const left of [8, 3, 1]) {
      const m = position({ ...FIXTURES.pattern, pattern: { ...SNAP, beatsLeft: left, beat: 9 - left } });
      assert.deepEqual(m?.pattern, { kind: "count", side: "UP", count: String(left) });
    }
  });

  it("keeps its label, and the Song metric keeps its own", () => {
    const m = toRoomModel(FIXTURES.pattern).metrics;
    assert.deepEqual(m.map((x) => x.label), ["Cadence", "Position", "Song"]);
    assert.deepEqual([m[2].value, m[2].unit], ["128", "bpm"]);
  });

  it("says 'Starts on the next bar' beside the first side while a next_downbeat pattern waits", () => {
    assert.deepEqual(position(FIXTURES["pattern-next-bar"])?.pattern, { kind: "soon", side: "UP", text: NOTE_STARTS_SOON });
  });

  it("tempo only: an interval_start pattern counts at the bpm; a next_downbeat one says 'Count from the music'", () => {
    assert.deepEqual(position(FIXTURES["pattern-tempo-only"])?.pattern, { kind: "count", side: "UP", count: "5" });
    const nextBar = FIXTURES["pattern-next-bar"];
    const noAnchors = (input: RoomInput, snap: PatternInput | null): RoomInput => {
      const doc = input.doc as Class;
      const songs = doc.songs.map((s) => ({ ...s, beat_anchors: undefined })) as Class["songs"];
      return { ...input, doc: { ...doc, songs }, pattern: snap };
    };
    assert.deepEqual(position(noAnchors(nextBar, SNAP))?.pattern, { kind: "note", text: NOTE_NO_COUNT });
    assert.deepEqual(position(noAnchors(nextBar, null))?.pattern, { kind: "note", text: NOTE_NO_COUNT });
  });

  it("no lock: 'Count from the music', whatever count the player holds", () => {
    const running = FIXTURES.pattern;
    for (const state of ["Coasting", "Off the list", "Paused", "Ambiguous", "Manual"] as const) {
      assert.deepEqual(position({ ...withLink(running, state), pattern: SNAP })?.pattern, { kind: "note", text: NOTE_NO_COUNT }, state);
    }
    assert.deepEqual(position({ ...withLink(running, "Locked", { held: true, holdRemainingMs: 5000 }), pattern: SNAP })?.pattern, { kind: "note", text: NOTE_NO_COUNT }, "held");
    assert.deepEqual(position(FIXTURES["pattern-no-count"])?.pattern, { kind: "note", text: NOTE_NO_COUNT });
  });

  it("a song with no tempo: 'No tempo: count from the music', 'Song, no tempo', no bars line", () => {
    const input = FIXTURES["pattern-no-tempo"];
    const m = toRoomModel(input);
    assert.deepEqual(position(input)?.pattern, { kind: "note", text: NOTE_NO_TEMPO });
    assert.deepEqual([m.metrics[2].label, m.metrics[2].value, m.metrics[2].unit], ["Song, no tempo", "–", null]);
    assert.equal(m.clock?.line, null);
    assert.equal(m.beat, null);
  });

  it("beat anchors without a bpm are still no tempo: the note, 'Song, no tempo' and '–', no bars line, no beat dot, even with a count sent", () => {
    const input = FIXTURES["pattern-anchors-only"];
    const song = (input.doc as Class).songs.find((s) => s.start_ms <= (input.view?.classMs ?? 0) && (input.view?.classMs ?? 0) < s.end_ms);
    assert.ok(song?.beat_anchors && song.bpm === undefined, "the fixture has anchors and no bpm");
    const m = toRoomModel(input);
    assert.deepEqual(position(input)?.pattern, { kind: "note", text: NOTE_NO_TEMPO });
    assert.deepEqual([m.metrics[2].label, m.metrics[2].value, m.metrics[2].unit], ["Song, no tempo", "–", null]);
    assert.equal(m.clock?.line, null);
    assert.equal(m.beat, null);
  });

  it("a paused clock with the link still Locked shows no frozen count", () => {
    const input = FIXTURES.pattern;
    assert.equal(position(input)?.pattern?.kind, "count");
    const view = input.view;
    assert.ok(view);
    const paused = { ...input, view: { ...view, status: "paused" as const } };
    assert.deepEqual(position(paused)?.pattern, { kind: "note", text: NOTE_NO_COUNT });
  });

  it("an interval with no pattern keeps its word, even if a count is sent", () => {
    const m = toRoomModel({ ...FIXTURES.running, pattern: SNAP });
    assert.deepEqual([m.metrics[1].value, m.metrics[1].pattern], ["Seated", undefined]);
  });

  it("never turns a pattern into a hand icon or advice: words only", () => {
    const m = position(FIXTURES.pattern);
    assert.match(m?.value ?? "", /^[A-Z]+ \d+$/);
  });
});

describe("the next row", () => {
  it("names a pattern in words, in place of Seated or Standing", () => {
    assert.equal(toRoomModel(FIXTURES.pattern).next?.position, "4 up, 4 down");
    assert.equal(toRoomModel(FIXTURES["pattern-three"]).next?.position, "4 up, 4 down, 8 up");
    const doc = FIXTURES.pattern.doc as Class;
    assert.equal(patternWords({ kind: "alternate", positions: ["seated", "standing"], beats: [12, 3] }), "12 down, 3 up");
    assert.ok(doc.intervals[7].pattern);
  });

  it("carries the next interval's cue, as written, for its second line", () => {
    assert.equal(toRoomModel(FIXTURES.pattern).next?.cue, "Settle in and spin it out. Eyes up, shoulders loose.");
    assert.ok((toRoomModel(FIXTURES["worst-pattern"]).next?.cue?.length ?? 0) >= 115, "the longest cue the format allows (120)");
  });

  it("has no second line for a next interval with no cue, nor for the end of the class", () => {
    const doc = FIXTURES.running.doc as Class;
    const intervals = doc.intervals.map((iv, i) => (i === 7 ? { ...iv, cue: "   " } : iv)) as Class["intervals"];
    assert.equal(toRoomModel({ ...FIXTURES.running, doc: { ...doc, intervals } }).next?.cue, null);
    assert.equal(toRoomModel(FIXTURES["last-interval"]).next?.cue, null);
  });
});
