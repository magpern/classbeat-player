// A running class as recorded snapshots (docs/design/running-class.md; mockups/runclass-room*.html):
// the zone with its %HRmax and RPE targets, the incline target as text, no cadence and no position.
// The format is that of ADR 0003: a running interval has `incline` and none of `cadence`, `position`,
// `pattern` or `test`.
import type { Class, RoomInput } from "../room/input.ts";
import { classOf, intervalsFrom, scaleOf, snapshot, songsFrom } from "./build.ts";

// Five zones: a running class has no more (the class format, zone_out_of_range_for_sport).
const NAMES = ["Recovery", "Endurance", "Tempo", "Threshold", "VO2 max"];
const HR: readonly (readonly [number, number])[] = [[50, 60], [61, 70], [71, 80], [81, 89], [90, 100]];

const scale = scaleOf(NAMES, (z) => ({ hrmax_pct: [...HR[z - 1]] as [number, number], rpe: [Math.min(10, z + 1), Math.min(10, z + 2)] as [number, number] }));

/** `[length in seconds, zone, incline]`: flat stretches and two raised ones. */
const PLAN: readonly (readonly [number, number, "flat" | "raised"])[] = [[180, 1, "flat"], [300, 2, "flat"], [240, 4, "raised"], [120, 2, "flat"], [300, 5, "raised"], [120, 2, "flat"], [180, 1, "flat"]];

/** A 24-minute running class with music: interval 2 is raised (the next flat), interval 3 flat (the next raised). */
export function runningClass(): Class {
  const intervals = intervalsFrom(
    0,
    PLAN.map(([sec, zone]) => [sec, zone] as const),
    "Keep the stride light.",
  ).map((iv, i) => {
    // `intervalsFrom` builds a cycling interval; a running one has its incline and neither cadence nor position.
    const running: Record<string, unknown> = { ...iv, incline: PLAN[i][2] };
    delete running.cadence;
    delete running.position;
    return running;
  });
  const songs = songsFrom(0, [
    ["Open Road", "Kite Season", 300, 160], ["Steady State", "Northbound", 300, 164], ["Second Wind", "Low Tide", 280, 160],
    ["Long Stride", "Aurora Lane", 280, 168], ["Cool Air", "Harbour Lights", 280, 156],
  ]);
  const segments = [
    { name: "Warm-up", kind: "warmup" as const, start_ms: 0, end_ms: 480_000 },
    { name: "Main set", kind: "main" as const, start_ms: 480_000, end_ms: 1_260_000 },
    { name: "Cool-down", kind: "cooldown" as const, start_ms: 1_260_000, end_ms: 1_440_000 },
  ];
  const doc = classOf("Thursday tempo run", scale, intervals as unknown as Class["intervals"], songs, segments, 40);
  // The totals name every zone of the scale, a zone not used with 0 (totals_zone_keys_mismatch).
  const time_in_zone_ms = Object.fromEntries(scale.map((z) => [String(z.zone), doc.totals.time_in_zone_ms[String(z.zone)] ?? 0]));
  return { ...doc, class: { ...doc.class, sport: "running" }, totals: { ...doc.totals, time_in_zone_ms } };
}

export const RUNNING_FIXTURES: Readonly<Record<string, RoomInput>> = (() => {
  const doc = runningClass();
  return {
    // Interval 2 (Threshold, raised) has 1:10 left; the next one is flat.
    "running-class": snapshot(doc, 650_000, "Locked"),
    // Interval 3 (Endurance, flat) has 1:10 left; the next one is raised.
    "running-class-flat": snapshot(doc, 770_000, "Locked"),
  };
})();
