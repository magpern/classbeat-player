// The position pattern's count (scene.md S14): the side and the beats left, stepping on the beat,
// reaching the next side exactly on the switch beat, naming the next side, and never guessed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTE_NO_COUNT, NOTE_NO_TEMPO, NOTE_STARTS_SOON, patternState } from "../src/text-pattern-calc.ts";
import type { PatternState } from "../src/text-pattern-calc.ts";
import type { TextInterval, TextPattern, TextSong } from "../src/text-types.ts";

const BEAT = 60_000 / 120;
const song = (extra: Partial<TextSong> = {}): TextSong => ({ title: "t", artist: "a", startMs: 0, lengthMs: 600_000, bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }], ...extra });
const interval = (pattern: TextPattern, startMs = 10_000): TextInterval => ({ startMs, lengthMs: 120_000, zone: 4, name: "Threshold", cue: "", cadence: null, position: "seated", pattern });
const updown: TextPattern = { positions: ["standing", "seated"], beats: [8, 8], startOn: "interval_start" };
const at = (iv: TextInterval, s: TextSong, level: "Beat" | "Tempo only" | "None", classMs: number): PatternState | null => patternState({ iv, song: s, level, classMs, songPosMs: classMs });
const count = (state: PatternState | null) => (state?.kind === "count" ? [state.side, state.left] : [state?.kind]);

test("at the Beat level the count starts at the interval's start and steps on every beat: UP 8 ... 1, then DOWN 8", () => {
  const iv = interval(updown);
  assert.deepEqual(count(at(iv, song(), "Beat", 10_000)), ["UP", 8]);
  assert.deepEqual(count(at(iv, song(), "Beat", 10_000 + BEAT - 1)), ["UP", 8]);
  assert.deepEqual(count(at(iv, song(), "Beat", 10_000 + BEAT)), ["UP", 7]);
  assert.deepEqual(count(at(iv, song(), "Beat", 10_000 + 7 * BEAT)), ["UP", 1]);
  assert.deepEqual(count(at(iv, song(), "Beat", 10_000 + 8 * BEAT)), ["DOWN", 8], "the count reaches the next side exactly on the switch beat");
  assert.deepEqual(count(at(iv, song(), "Beat", 10_000 + 16 * BEAT)), ["UP", 8], "and the pattern repeats");
});

test("the next side is named, 'then up again' where two neighbouring entries are the same side", () => {
  const three: TextPattern = { positions: ["standing", "seated", "standing"], beats: [4, 4, 8], startOn: "interval_start" };
  const iv = interval(three);
  const then = (classMs: number) => { const s = at(iv, song(), "Beat", classMs); return s?.kind === "count" ? s.then : null; };
  assert.equal(then(10_000), "then down");
  assert.equal(then(10_000 + 4 * BEAT), "then up");
  assert.equal(then(10_000 + 8 * BEAT), "then up again", "the last entry is followed by the first, both standing");
  const s = at(iv, song(), "Beat", 10_000 + 8 * BEAT);
  assert.equal(s?.kind === "count" ? s.total : 0, 8);
});

test("tempo only: an interval_start pattern counts at the bpm from the interval's start; a next_downbeat one does not count", () => {
  const tempoSong = song({ anchors: undefined });
  const iv = interval(updown);
  assert.deepEqual(count(at(iv, tempoSong, "Tempo only", 10_000)), ["UP", 8]);
  assert.deepEqual(count(at(iv, tempoSong, "Tempo only", 10_000 + 8 * BEAT)), ["DOWN", 8]);
  const down = interval({ ...updown, startOn: "next_downbeat" });
  assert.deepEqual(at(down, tempoSong, "Tempo only", 20_000), { kind: "note", text: NOTE_NO_COUNT });
});

test("next_downbeat: the first side and 'starts on the next bar' until the downbeat, then the count", () => {
  const iv = interval({ ...updown, startOn: "next_downbeat" }, 10_000 + BEAT); // starts one beat after a downbeat (beat 21 of 4-beat bars)
  const before = at(iv, song(), "Beat", 10_000 + BEAT);
  assert.deepEqual(before, { kind: "soon", side: "UP", text: NOTE_STARTS_SOON });
  const bar = 4 * BEAT;
  assert.equal(at(iv, song(), "Beat", 10_000 + bar - 1)?.kind, "soon");
  assert.deepEqual(count(at(iv, song(), "Beat", 10_000 + bar)), ["UP", 8], "the first bar's downbeat starts the count");
});

test("no lock, no bpm: the side and the count are never guessed, and the block says why", () => {
  const iv = interval(updown);
  assert.deepEqual(at(iv, song(), "None", 12_000), { kind: "note", text: NOTE_NO_COUNT });
  const none = song({ bpm: undefined, anchors: undefined });
  assert.deepEqual(at(iv, none, "None", 12_000), { kind: "note", text: NOTE_NO_TEMPO });
  assert.deepEqual(at(iv, none, "Beat", 12_000), { kind: "note", text: NOTE_NO_TEMPO });
  assert.equal(at({ ...iv, pattern: null }, song(), "Beat", 12_000), null, "an interval without a pattern has no block");
});
