// A fake running class for the demo page and the scene's screenshots (ADR 0015, scene.md "A running class"):
// `sport` is "running" and every interval has an incline, no cadence, position or pattern. Its songs and zones
// follow the default demo class, so what the scene draws for it is what it draws for a cycling class. The scene
// and the text are derived by the join's own `deriveClass`, never built by hand, so the shot exercises the real
// input path. Fake data only.
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { deriveClass } from "../join/room-feed-calc.ts";
import type { Variant } from "./scenario.ts";

const S = 1000;
const ZONES = ["Recovery", "Endurance", "Tempo", "Threshold", "VO2 max", "Anaerobic", "Neuromuscular"];
const PLAN: readonly (readonly [number, number, "flat" | "raised"])[] = [[0, 1, "flat"], [20, 2, "flat"], [40, 4, "raised"], [60, 5, "raised"], [80, 6, "raised"], [100, 7, "raised"], [120, 3, "flat"], [140, 2, "flat"]];
const SONGS = [
  { start: 0, length: 60, bpm: 120, moments: [{ at_ms: 40 * S, kind: "drop" }, { at_ms: 58 * S, kind: "drop" }] },
  { start: 60, length: 40, bpm: 128 },
  { start: 100, length: 60, bpm: 100, moments: [{ at_ms: 20 * S, kind: "breakdown" }] },
];

export const RUNNING_DOC = {
  format_version: "1.0",
  class: { title: "Demo run", sport: "running", length_ms: 160 * S },
  music: { source: "spotify", design_crossfade_ms: 0, song_timing: "measured" },
  zone_scale: ZONES.map((name, i) => ({ zone: i + 1, name, hrmax_pct: [50 + i * 8, 58 + i * 8], rpe: [i + 1, i + 2] })),
  intervals: PLAN.map(([startS, zone, incline]) => ({ start_ms: startS * S, length_ms: 20 * S, zone, cue: "Hold the pace you chose and breathe out.", incline })),
  songs: SONGS.map((s, i) => ({
    title: `Song ${i + 1}`, artist: "Demo", start_ms: s.start * S, end_ms: (s.start + s.length) * S, length_ms: s.length * S, bpm: s.bpm,
    beat_anchors: { quality: "measured", anchors: [{ at_ms: 0, bpm: s.bpm }] },
    ...(s.moments ? { moments: { quality: "measured", items: s.moments } } : {}),
  })),
} as unknown as Class;

const made = deriveClass(RUNNING_DOC);
if (made === null) throw new Error("the demo running class has songs, so the scene derives it");

export const RUNNING_VARIANT: Variant = { cls: made.scene, starts: SONGS.map((s) => s.start * S) };
export const RUNNING_TEXT = made.text;
