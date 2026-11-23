// The song's beat grid, as the player counts on it (player/app/src/core/clock/pattern.ts, `beatCoord`; the web lane may not import
// the player, so the rule is written out here and the unit test `switch-beat.test.ts` holds it to the player's own count). Pure.
interface Anchor {
  readonly atMs: number;
  readonly bpm: number;
}
export interface BeatGrid {
  readonly bpm: number;
  /** Song-relative, increasing. */
  readonly anchors: readonly Anchor[];
}

const MS_PER_MIN = 60_000;
const EPS = 1e-9;

/**
 * Beat coordinate at song time `u` (ms from the song window start): beats since the grid's origin. Without anchors the origin is the
 * window start at the song's `bpm`. With anchors each starts a beat and its own tempo runs until the next; before the first one the
 * song's `bpm` runs backwards from it.
 */
export function beatCoord(s: BeatGrid, u: number): number {
  const a = s.anchors;
  if (a.length === 0) return (u * s.bpm) / MS_PER_MIN;
  if (u < a[0].atMs) return ((u - a[0].atMs) * s.bpm) / MS_PER_MIN;
  let base = 0;
  let k = 0;
  while (k + 1 < a.length && a[k + 1].atMs <= u) {
    base += Math.round(((a[k + 1].atMs - a[k].atMs) * a[k].bpm) / MS_PER_MIN);
    k += 1;
  }
  return base + ((u - a[k].atMs) * a[k].bpm) / MS_PER_MIN;
}

/**
 * Song time of beat coordinate `c`, the inverse of `beatCoord` (the player's `coordTime`, line for line). At an anchor the coordinate
 * can step back a little: `beatCoord` adds whole beats (`Math.round`) for the span before it. So the coordinate is not monotonic there
 * and is not searched for by halving: each span is taken in order, as the player does, and the first span that holds `c` gives the time.
 */
function coordTime(s: BeatGrid, c: number): number {
  const a = s.anchors;
  if (a.length === 0) return (c * MS_PER_MIN) / s.bpm;
  if (c < 0) return a[0].atMs + (c * MS_PER_MIN) / s.bpm;
  let base = 0;
  let k = 0;
  while (k + 1 < a.length) {
    const next = base + Math.round(((a[k + 1].atMs - a[k].atMs) * a[k].bpm) / MS_PER_MIN);
    if (next > c) break;
    base = next;
    k += 1;
  }
  return a[k].atMs + ((c - base) * MS_PER_MIN) / a[k].bpm;
}

/** Song time of the `n`-th beat onset after song time `u` (n >= 1): the player's count steps on that onset. */
export function nthOnsetAfter(s: BeatGrid, u: number, n: number): number {
  return coordTime(s, Math.floor(beatCoord(s, u) + EPS) + n);
}
