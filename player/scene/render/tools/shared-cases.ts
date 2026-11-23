// The generated cases of the shared-1 gates (scene.md "The CI check that the sway makes at most 1", "The CI check that a sweep makes at most
// 1", "The CI gate for a burst's decay"): which look, zone row, phrase parity, tempo and quality level each case plays, in which state, and the
// coverage check that fails a matrix with a look, a zone, a parity, a tempo, a quality level, a state or a cause that has no case. Pure.
import { LOOKS } from "../../model/src/index.ts";
import type { Look } from "../../model/src/index.ts";
import type { GenSpec } from "../demo/generated.ts";

/** The states the matrices run: locked with the beat (Beat level), locked at Tempo only (no anchors) and coasting (None level). */
export const STATES = [
  { name: "locked", query: "", tempoOnly: false },
  { name: "tempo only", query: "", tempoOnly: true },
  { name: "coasting", query: "&state=coasting", tempoOnly: false },
] as const;
export type StateName = (typeof STATES)[number]["name"];
export const TEMPOS = [60, 90, 120, 150, 180, 200] as const;
export const QUALITIES = ["High", "Medium", "Low"] as const;
export const ZONE_ROWS = [1, 2, 3, 4, 5, 6, 7] as const;
/** Where the case's song starts on the class clock: after the filler songs, and with the warm-up inside it. */
export const SONG_START_MS = 100_000;
/** A phrase is 8 bars of 4 beats. */
export const phraseMs = (bpm: number): number => (32 * 60_000) / bpm;

export interface Factors {
  readonly look: Look;
  readonly zone: number;
  readonly parity: 0 | 1;
  readonly bpm: number;
  readonly quality: (typeof QUALITIES)[number];
}

/**
 * `count` cases whose factors are balanced: the zone rows (7) and the looks (5) cycle together, so 35 cases hold every look in every zone
 * row; the parity, the tempo and the quality level follow from them on strides that cover each of their values with every look. A smaller
 * `count` (7 or more) still holds every zone and every look.
 */
export function factorsFor(count: number, offset = 0): Factors[] {
  return Array.from({ length: count }, (_, k) => {
    const n = k + offset;
    const zone = ZONE_ROWS[n % 7]!;
    const l = n % 5;
    return { look: LOOKS[l]!, zone, parity: ((zone + l) % 2) as 0 | 1, bpm: TEMPOS[(5 * zone + l) % 6]!, quality: QUALITIES[(zone + 2 * l) % 3]! };
  });
}

/** Every look in every zone row: 35 cases. */
export const lookByZone = (): Factors[] => ZONE_ROWS.flatMap((zone) => LOOKS.map((look, l) => ({ look, zone, parity: ((zone + l) % 2) as 0 | 1, bpm: TEMPOS[(5 * zone + l) % 6]!, quality: QUALITIES[(zone + 2 * l) % 3]! })));

/** The generated class a case plays in: the song at the look's index, from `SONG_START_MS`. */
export const specOf = (f: Factors, tempoOnly: boolean, extra: Partial<GenSpec> = {}): GenSpec => ({
  songIndex: LOOKS.indexOf(f.look), bpm: f.bpm, zone: f.zone, startMs: SONG_START_MS, tempoOnly, ...extra,
});

/** A phrase of the wanted parity, 2 or 3 (never the first: its mirror state is the song's start): its first frame, in the song's own time. */
export const phraseStartMs = (f: Factors): number => (f.parity + 2) * phraseMs(f.bpm);

/** What a matrix must hold: fails, naming what has no case. */
export function missing(cases: readonly (Factors & { readonly state?: string; readonly cause?: string })[], wanted: { readonly states?: readonly string[]; readonly causes?: readonly string[] } = {}): string[] {
  const has = <T>(xs: readonly T[], all: readonly T[], what: string) => all.filter((x) => !xs.includes(x)).map((x) => `${what} ${String(x)}`);
  return [
    ...has(cases.map((c) => c.look), LOOKS, "look"),
    ...has(cases.map((c) => c.zone), ZONE_ROWS, "zone"),
    ...has(cases.map((c) => c.parity), [0, 1], "parity"),
    ...has(cases.map((c) => c.bpm), TEMPOS, "tempo"),
    ...has(cases.map((c) => c.quality), QUALITIES, "quality"),
    ...has(cases.flatMap((c) => (c.state === undefined ? [] : [c.state])), wanted.states ?? [], "state"),
    ...has(cases.flatMap((c) => (c.cause === undefined ? [] : [c.cause])), wanted.causes ?? [], "cause"),
  ];
}
