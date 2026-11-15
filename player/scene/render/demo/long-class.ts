// A fake class with the lengths of a real one, for the text layer's screenshots and measurements:
// sixteen minutes, all seven zones, four songs, three position patterns (one of each count level),
// and the cues, names and targets the room screen shows. The rig's own `SceneClass` and the text
// layer's `TextClass` are built from the same table so they always agree. Fake data only.
import type { SceneClass, SceneSong } from "../../model/src/index.ts";
import type { Feed } from "../src/loop.ts";
import type { Side, TextClass, TextInterval, TextPattern, TextSong, TextZone } from "../src/text-types.ts";

const S = 1000;
const zone = (zone: number, name: string, targets: string[]): TextZone => ({ zone, name, targets });
export const TEXT_ZONES: readonly TextZone[] = [
  zone(1, "Recovery", ["< 55% FTP", "RPE 1–2"]), zone(2, "Endurance", ["56–75% FTP", "RPE 3–4"]), zone(3, "Tempo", ["76–90% FTP", "RPE 5–6"]),
  zone(4, "Threshold", ["91–105% FTP", "RPE 7"]), zone(5, "VO2 max", ["106–120% FTP", "RPE 8"]), zone(6, "Anaerobic", ["121–150% FTP", "RPE 9"]),
  zone(7, "Neuromuscular", ["> 150% FTP", "RPE 10"]),
];

const pattern = (positions: Side[], beats: number[], startOn: TextPattern["startOn"]): TextPattern => ({ positions, beats, startOn });
const iv = (startS: number, lengthS: number, z: number, name: string, cue: string, cadence: TextInterval["cadence"], position: Side | null, p: TextPattern | null = null): TextInterval =>
  ({ startMs: startS * S, lengthMs: lengthS * S, zone: z, name, cue, cadence, position, pattern: p });

export const LONG_TEXT_INTERVALS: readonly TextInterval[] = [
  iv(0, 120, 1, "Warm up", "Easy spin. Find your rhythm and let your shoulders drop.", { from: 80, to: 90 }, "seated"),
  iv(120, 120, 2, "Endurance", "Settle in and spin it out. Eyes up, shoulders loose, breathe.", { from: 85, to: 95 }, "seated"),
  iv(240, 90, 3, "Tempo", "Find the beat and hold it. Breathe out on every second bar.", { from: 90, to: 100 }, "seated"),
  iv(330, 120, 4, "Threshold", "Jump on the drop: up for eight beats, down for eight. Land soft and keep the legs loose.", { from: 70, to: 80 }, "seated", pattern(["standing", "seated"], [8, 8], "interval_start")),
  iv(450, 90, 5, "VO2 max", "Push through the heat. Short, hard, and then you get it all back.", { from: 95, to: 105 }, "seated"),
  iv(540, 90, 6, "Anaerobic", "Four up, four down, then eight up. Count out loud with the room.", { from: 100, to: 110 }, "standing", pattern(["standing", "seated", "standing"], [4, 4, 8], "next_downbeat")),
  iv(630, 90, 7, "Neuromuscular", "Everything you have, now. Sprint on the beat and don't look at the clock.", { from: 100, to: 110 }, "standing"),
  iv(720, 120, 3, "Tempo", "Back to a steady rhythm. Find your breath and keep the cadence even.", "beat", "seated", pattern(["standing", "seated"], [8, 8], "interval_start")),
  iv(840, 120, 2, "Endurance", "Cool down, spin it out. Drink, stretch your back, and smile.", { from: 70, to: 80 }, "seated"),
];

const SONGS: readonly (TextSong & SceneSong)[] = [
  { title: "Neon Avenue", artist: "Pulse Theory", startMs: 0, lengthMs: 240 * S, bpm: 120, anchors: [{ at_ms: 0, bpm: 120 }], moments: [{ at_ms: 200 * S, kind: "drop" }] },
  { title: "Aurora Lane", artist: "Night Signal", startMs: 240 * S, lengthMs: 240 * S, bpm: 128, anchors: [{ at_ms: 0, bpm: 128 }], moments: [{ at_ms: 120 * S, kind: "drop" }] },
  { title: "Slow Fire", artist: "Harbour Lights", startMs: 480 * S, lengthMs: 240 * S, bpm: 100, anchors: [{ at_ms: 0, bpm: 100 }], moments: [{ at_ms: 60 * S, kind: "breakdown" }, { at_ms: 170 * S, kind: "drop" }] },
  { title: "Glass Rooms", artist: "Wide Open", startMs: 720 * S, lengthMs: 240 * S, bpm: 124 },
];

export const LONG_END_MS = 960 * S;
export const LONG_SCENE: SceneClass = {
  songs: SONGS.map(({ bpm, anchors, moments }) => ({ bpm, anchors, moments })),
  intervals: LONG_TEXT_INTERVALS.map((i) => ({ startMs: i.startMs, zone: i.zone })),
  endMs: LONG_END_MS,
};
export const LONG_TEXT: TextClass = {
  title: "Long demo ride", endMs: LONG_END_MS, zones: TEXT_ZONES, intervals: LONG_TEXT_INTERVALS, songs: SONGS,
  segments: [{ startMs: 0, name: "Warm-up" }, { startMs: 240 * S, name: "Main set" }, { startMs: 840 * S, name: "Cool-down" }],
  following: "Following Spotify",
};

export function longSongIndexAt(classMs: number): number {
  let at = 0;
  SONGS.forEach((s, i) => { if (classMs >= s.startMs) at = i; });
  return at;
}

export function longFeedAt(classMs: number, link: Feed["link"], reducedMotion: boolean): Feed {
  const songIndex = longSongIndexAt(classMs);
  return { cls: LONG_SCENE, classMs, songIndex, songPosMs: classMs - (SONGS.at(songIndex)?.startMs ?? 0), link, reducedMotion };
}

/**
 * The worst case of scene.md "Fitting": a 15-minute interval (a five-glyph countdown) with a pattern,
 * cadence "100–110 rpm", the widest zone name, and 120-character current and next cues.
 */
const CUE_120 = "Hold the cadence and breathe out on every second bar. Eyes up, shoulders loose, and keep the legs turning over smoothly now.";
export const WORST_TEXT: TextClass = {
  ...LONG_TEXT,
  zones: TEXT_ZONES.map((z) => (z.zone === 4 ? { ...z, name: "Neuromuscular Power" } : z)),
  // The long interval pushes the ones after it back by its extra 13 minutes, so no two blocks overlap.
  intervals: LONG_TEXT_INTERVALS.map((v, i) => (i === 3 ? { ...v, lengthMs: 900 * S, cue: CUE_120, cadence: { from: 100, to: 110 } } : i === 4 ? { ...v, startMs: v.startMs + 780 * S, cue: CUE_120 } : i > 4 ? { ...v, startMs: v.startMs + 780 * S } : v)),
  endMs: LONG_END_MS + 780 * S,
};
