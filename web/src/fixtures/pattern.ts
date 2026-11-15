// The states of the room screen's follow-up (docs/design/room-2d.md, "The follow-up to the scene"):
// a position pattern in the Position metric, the next interval's cue and the five-minute score, each
// as a recorded snapshot, and their worst cases. Content follows the reference mock-ups
// (mockups/room-pattern*.html, room-worst-pattern*.html). Format 1.1: `pattern` is on the interval;
// the count comes from the player's snapshot (`pattern`, here recorded, never counted by the screen).
import type { Class, PatternInput, RoomInput } from "../room/input.ts";
import { clockAt, linkAt, withCue } from "./build.ts";
import { STATE_FIXTURES } from "./states.ts";
import { WORST_FIXTURES } from "./worst.ts";

type Interval = Class["intervals"][number];
type Pattern = NonNullable<Interval["pattern"]>;

const NEXT_CUE = "Settle in and spin it out. Eyes up, shoulders loose.";
/** 120 characters: the longest cue the format allows. */
const NEXT_CUE_120 = "Drop into the saddle and settle your breathing; count the bars out loud, keep the wheel turning and wait for the call!";
const CUE_120 = "Stay tall through the shoulders and let the legs spin freely, then find the beat and lean into it for the full eight bars!";
const CUE_WIDE = "WHOA: MOVE WITH THE MUSIC. WOW, MOMENTUM NOW. MAXIMUM WORK, WIDE KNEES, MOW THE HILL. WE WIN WHEN WE MOVE AS ONE. WOW!";

const alt = (positions: Pattern["positions"], beats: Pattern["beats"], start_on?: Pattern["start_on"]): Pattern => ({ kind: "alternate", positions, beats, ...(start_on ? { start_on } : {}) });
const EIGHT_EIGHT = alt(["standing", "seated"], [8, 8]);

/** The player's count: the side, the beat on it and the beats left (what `patternSnapshotAt` sends). */
const count = (position: PatternInput["position"], beatsLeft: number, n: number): PatternInput => ({ position, beat: n - beatsLeft + 1, beatsLeft, nextPosition: position === "standing" ? "seated" : "standing" });

/** `doc` with a pattern on interval `index` (`position` follows `positions[0]`, as the format says) and the cue of the next one. */
function patterned(doc: Class, index: number, pattern: Pattern, next: { pattern?: Pattern; cue: string }): Class {
  const intervals = doc.intervals.map((iv, i) => {
    if (i === index) return { ...iv, pattern, position: pattern.positions[0] };
    if (i === index + 1) return { ...iv, cue: next.cue, ...(next.pattern ? { pattern: next.pattern, position: next.pattern.positions[0] } : {}) };
    return iv;
  }) as Class["intervals"];
  return { ...doc, format_version: "1.1", intervals };
}

function recorded(doc: Class, classMs: number, state: Parameters<typeof linkAt>[1], pattern: PatternInput | null, songPatch?: Partial<Class["songs"][number]>): RoomInput {
  const songs = songPatch ? (doc.songs.map((s) => (s.start_ms <= classMs && classMs < s.end_ms ? { ...s, ...songPatch } : s)) as Class["songs"]) : doc.songs;
  const d = { ...doc, songs };
  const view = clockAt(d, classMs);
  return { doc: d, view, link: linkAt(view, state), pattern };
}

export const PATTERN_FIXTURES: Readonly<Record<string, RoomInput>> = (() => {
  const base = STATE_FIXTURES.running.doc as Class;
  const at = 1_099_000; // 18:19: Threshold has 1:10 left, Neon Avenue plays (128 bpm, beat anchors)
  const doc = patterned(base, 6, EIGHT_EIGHT, { pattern: alt(["standing", "seated"], [4, 4]), cue: NEXT_CUE });
  // The song's anchors are removed (a bpm and nothing else): the tempo-only level.
  const tempoOnly = { beat_anchors: undefined };
  const startsOnBar = patterned(base, 6, alt(["standing", "seated"], [8, 8], "next_downbeat"), { pattern: alt(["standing", "seated"], [4, 4]), cue: NEXT_CUE });
  const noTempo = patterned(base, 6, EIGHT_EIGHT, { pattern: alt(["standing", "seated"], [4, 4]), cue: NEXT_CUE });
  return {
    "pattern": recorded(doc, at, "Locked", count("standing", 6, 8)),
    // The other side with two figures left: DOWN beside "12" (a 12-beat side).
    "pattern-down": recorded(patterned(base, 6, alt(["seated", "standing"], [12, 12]), { cue: NEXT_CUE }), at, "Locked", count("seated", 12, 12)),
    "pattern-next-bar": recorded(startsOnBar, at, "Locked", null),
    "pattern-no-count": recorded(doc, at, "Coasting", null),
    "pattern-tempo-only": recorded(doc, at, "Locked", count("standing", 5, 8), tempoOnly),
    "pattern-no-tempo": recorded(noTempo, at, "Locked", null, { bpm: undefined, beat_anchors: undefined }),
    // Three entries named in the next row.
    "pattern-three": recorded(patterned(base, 6, EIGHT_EIGHT, { pattern: alt(["standing", "seated", "standing"], [4, 4, 8]), cue: NEXT_CUE }), at, "Locked", count("standing", 1, 8)),
  };
})();

/** The worst case (mockups/room-worst-pattern*.html): "DOWN 64", "100–110 rpm", 200 bpm, a 120-character cue and next cue, a three-entry pattern next. */
export const WORST_PATTERN_FIXTURES: Readonly<Record<string, RoomInput>> = (() => {
  const base = WORST_FIXTURES["worst-running"];
  const baseDoc = base.doc as Class;
  const at = (base.view as NonNullable<RoomInput["view"]>).classMs;
  const next = { pattern: alt(["standing", "seated", "standing"], [4, 4, 8]), cue: NEXT_CUE_120 };
  const deep = alt(["seated", "standing"], [64, 64]);
  const make = (cue: string, pattern: Pattern, snap: PatternInput | null, state: Parameters<typeof linkAt>[1] = "Locked", songPatch?: Partial<Class["songs"][number]>): RoomInput => {
    const doc = patterned(withCue(baseDoc, 60, cue, { cadence: { from: 100, to: 110 } }), 60, pattern, next);
    const r = recorded(doc, at, state, snap, songPatch);
    return { ...r, view: { ...(r.view as NonNullable<RoomInput["view"]>), classRemainingMs: 7_138_000 }, link: { ...(r.link as NonNullable<RoomInput["link"]>), classRemainingMs: 7_138_000 } };
  };
  return {
    "worst-pattern": make(CUE_120, deep, count("seated", 64, 64)),
    "worst-pattern-four": make(CUE_WIDE, deep, count("seated", 64, 64)),
    "worst-pattern-no-tempo": make(CUE_120, deep, null, "Locked", { bpm: undefined, beat_anchors: undefined }),
    "worst-pattern-no-count": make(CUE_120, deep, null, "Off the list"),
  };
})();
