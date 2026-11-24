// gauge_calc: where the plan band and the reading's tick sit on a gauge (docs/design/sensors.md,
// "The gauge"). Pure. The track runs a band's width (at least 15 % of its top) either side of the
// plan, so the band always sits in the middle third or so, and the tick is clamped to the track.
/** A planned range, low to high, in the reading's unit. */
export type Range = readonly [number, number];

export interface Gauge {
  /** Percent of the track's width. */
  readonly bandLeft: number;
  readonly bandWidth: number;
  /** Null: no reading, no tick. */
  readonly tick: number | null;
}

const clamp = (lo: number, hi: number, v: number): number => Math.min(hi, Math.max(lo, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

export function gauge(plan: Range, value: number | null): Gauge {
  const [lo, hi] = plan;
  const w = Math.max(hi - lo, 0.15 * hi);
  const min = lo - w;
  const span = hi + w - min;
  const pct = (x: number): number => clamp(0, 100, ((x - min) / span) * 100);
  return { bandLeft: round1(pct(lo)), bandWidth: round1(pct(hi) - pct(lo)), tick: value === null ? null : round1(pct(value)) };
}
