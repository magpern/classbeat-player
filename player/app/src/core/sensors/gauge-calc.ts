// The gauge's scale (docs/design/sensors.md, "The gauge"). Pure. A line with the plan as a band and
// one tick for the reading. The tick says where the reading is and nothing else (rules 7, 8, 11).
export interface Gauge {
  /** The track's ends in the reading's unit (for the meter's text alternative). */
  readonly track: readonly [number, number];
  /** The planned band, as fractions 0..1 of the track. */
  readonly band: readonly [number, number];
  /** The reading's place on the track, 0..1, clamped to its ends; null when there is no reading. */
  readonly tick: number | null;
}

/** The track runs one band width below the plan to one band width above it. */
export function gaugeTrack(plan: readonly [number, number]): readonly [number, number] {
  const [from, to] = plan;
  const w = Math.max(to - from, 0.15 * to);
  return [from - w, to + w];
}

export function gauge(plan: readonly [number, number], reading: number | null): Gauge {
  const [lo, hi] = gaugeTrack(plan);
  const at = (v: number): number => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return { track: [lo, hi], band: [at(plan[0]), at(plan[1])], tick: reading === null ? null : at(reading) };
}
