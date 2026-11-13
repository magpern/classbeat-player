// The ten states of docs/design/room-2d.md ("States") as recorded snapshots of one 42-minute class
// (and, for the FTP test, a 45-minute one). Content follows the reference mock-ups.
import type { Class, RoomInput } from "../room/input.ts";
import { clockAt, classOf, intervalsFrom, linkAt, scaleOf, snapshot, songsFrom, withCue } from "./build.ts";

const NAMES = ["Recovery", "Endurance", "Tempo", "Threshold", "VO2 max", "Anaerobic capacity", "Neuromuscular power"];
const FTP: readonly (readonly [number, number])[] = [[50, 60], [61, 75], [76, 87], [88, 94], [95, 105], [106, 120], [121, 150]];

const scale = scaleOf(NAMES, (z) => ({ ftp_pct: [...FTP[z - 1]] as [number, number], rpe: [Math.min(10, z + 1), Math.min(10, z + 2)] as [number, number] }));

/** The class: warm-up, a main set with the Threshold interval playing at 18:19, a cool-down. */
function baseClass(): Class {
  const intervals = intervalsFrom(0, [
    [180, 1], [120, 2], [240, 3], [120, 2], [240, 3], [179, 2],
    [90, 4], [45, 2], [90, 5], [90, 3], [300, 4], [120, 2], [300, 5], [120, 6], [90, 7], [46, 2], [150, 1],
  ]);
  const songs = songsFrom(0, [
    ["Slow Sunrise", "Harbour Lights", 232, 104], ["Warm Current", "Harbour Lights", 248, 120], ["Glass Avenue", "Kite Season", 130, 120],
    ["Paper Moons", "Kite Season", 130, 120], ["Static Garden", "Northbound", 212, 120], ["Neon Avenue", "The Midnight Riders", 217, 128],
    ["Pulse Theory", "Aurora Lane", 249, 132], ["Long Way Round", "Low Tide", 282, 120], ["Cinder", "Aurora Lane", 280, 120],
    ["High Water", "Northbound", 360, 120], ["Afterglow", "Low Tide", 180, 96],
  ]);
  // A drop 45 s into Pulse Theory.
  songs[6] = { ...songs[6], moments: { quality: "measured", items: [{ at_ms: 45_000, kind: "drop" }] } };
  const segments = [
    { name: "Warm-up", kind: "warmup" as const, start_ms: 0, end_ms: 300_000 },
    { name: "Main set", kind: "main" as const, start_ms: 300_000, end_ms: 2_340_000 },
    { name: "Cool-down", kind: "cooldown" as const, start_ms: 2_340_000, end_ms: 2_520_000 },
  ];
  const doc = classOf("Thursday threshold", scale, intervals, songs, segments, 58);
  return withCue(doc, 6, "Find the beat and hold it. Breathe out on every second bar.", { cadence: { from: 90, to: 100 } });
}

/** A class with a 20-minute FTP test playing at 33:42 left of 45:00. */
function ftpClass(): Class {
  const names = [...NAMES];
  names[3] = "Functional threshold";
  const sc = scaleOf(names, (z) => (z === 4 ? { ftp_pct: [95, 105], rpe: [8, 9] } : { ftp_pct: [...FTP[z - 1]] as [number, number], rpe: [z + 1, z + 2] as [number, number] }));
  const intervals = intervalsFrom(0, [[300, 1], [300, 3], [1200, 4], [300, 1], [600, 2]]);
  const songs = songsFrom(0, [
    ["Open Road", "Kite Season", 520, 120], ["Tall Signals", "Northbound", 240, 126], ["Low Orbit", "Kite Season", 250, 124],
    ["Third Light", "Low Tide", 850, 118], ["Last Light", "Aurora Lane", 840, 120],
  ]);
  const segments = [{ name: "Main set", kind: "main" as const, start_ms: 0, end_ms: 2_700_000 }];
  let doc = classOf("Thursday threshold", sc, intervals, songs, segments, 61);
  doc = withCue(doc, 2, "Settle into the pace you can hold for the whole test. Breathe on the beat.", { cadence: { from: 95, to: 105 }, test: { kind: "ftp", minutes: 20 } });
  return withCue(doc, 3, "Easy now. Let the legs spin out.", { cadence: { from: 80, to: 90 } });
}

/** A 3-hour class with a 2-hour interval playing: 1:48:12 left of it, the next song in 3:05. */
function longClass(): Class {
  const intervals = intervalsFrom(0, [[300, 1], [7200, 3], [3300, 1]]);
  const songs = songsFrom(0, [
    ["Open Road", "Kite Season", 600, 120], ["Long Haul", "Northbound", 593, 124], ["Far Country", "Low Tide", 9607, 118],
  ]);
  const segments = [{ name: "Main set", kind: "main" as const, start_ms: 300_000, end_ms: 7_500_000 }];
  return classOf("Thursday threshold", scale, intervals, songs, segments, 140);
}

export const STATE_FIXTURES: Readonly<Record<string, RoomInput>> = (() => {
  const doc = baseClass();
  const at = 1_099_000; // 18:19: the Threshold interval has 1:10 left
  const view = clockAt(doc, at);
  const lastDoc = withCue(doc, 16, "Long, slow breaths. Let the legs go loose with the music.", { cadence: "beat" });
  const lastAt = 2_370_000;
  return {
    "before-start": snapshot(doc, 0, "Locked", "ready"),
    running: snapshot(doc, at, "Locked"),
    paused: snapshot(doc, at, "Paused", "paused"),
    coasting: snapshot(withCue(doc, 6, "Stay heavy on the pedals and keep your shoulders soft. This is the last hard minute of the set, so make every bar count."), at, "Coasting"),
    "off-list": snapshot(doc, at, "Off the list"),
    ambiguous: { doc, view, link: linkAt(view, "Ambiguous", { candidates: [5, 9] }) },
    manual: { doc, view, link: linkAt(view, "Manual") },
    "last-interval": snapshot(lastDoc, lastAt, "Locked"),
    finished: snapshot(doc, 2_520_000, "Locked", "ended"),
    "ftp-test": snapshot(ftpClass(), 678_000, "Locked"),
    // The last seconds of the Threshold interval (it ends at 19:29): "Change in", and the block
    // of the current interval has little room left ahead of "now" for its number.
    "change-in": snapshot(doc, 1_165_000, "Locked"),
    "end-3s": snapshot(doc, 1_166_000, "Locked"),
    "end-4s5": snapshot(doc, 1_164_500, "Locked"),
    "end-8s": snapshot(doc, 1_161_000, "Locked"),
    "end-11s": snapshot(doc, 1_158_000, "Locked"),
    // Held at the end of the song window: the last interval stays, its countdown is the expected time to the next song.
    hold: { doc, view: { ...view, classMs: 1_169_000, intervalRemainingMs: 0 }, link: linkAt(view, "Locked", { held: true, holdRemainingMs: 12_000 }) },
    "long-interval": snapshot(longClass(), 1_008_000, "Locked"),
    "before-start-manual": { doc, view: clockAt(doc, 0, "ready"), link: linkAt(clockAt(doc, 0, "ready"), "Manual") },
  };
})();
