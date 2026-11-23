// Classes the CI matrices generate (tools/shared-shots.ts, scene.md "The CI check that the sway makes at most 1", "The CI check that a
// sweep makes at most 1", "The CI gate for a burst's decay"): the page's `class=` names one. `tempo~<variant>` is that variant at Tempo only
// (the same songs without anchors: locked, the tempo known, no beat grid); `gen~<json>` is a class of one song at the look the song's index
// gives, in one zone, with the song's tempo, moments, length and the interval changes the case wants. Fake data only; nothing is read.
// The page looks a variant up by its name in `VARIANTS`: `withGenerated` makes the lookup answer these names too, so the page itself
// (demo/main.ts) needs no knowledge of the matrices.
import type { SceneClass, SceneSong, SongMoment } from "../../model/src/index.ts";
import type { Variant } from "./scenario.ts";

export interface GenSpec {
  /** The look is `LOOKS[songIndex % 5]`: the case plays in the song at this index. */
  readonly songIndex: number;
  readonly bpm: number;
  readonly zone: number;
  /** Where the song starts on the class clock, ms. */
  readonly startMs: number;
  readonly lengthMs?: number;
  readonly moments?: readonly SongMoment[];
  /** Interval changes: class-clock time and zone. */
  readonly changes?: readonly { readonly atMs: number; readonly zone: number }[];
  /** No anchors: the tempo is known and the beat is not placed. */
  readonly tempoOnly?: boolean;
}

const GEN = "gen~";
const TEMPO = "tempo~";
export const genName = (spec: GenSpec): string => GEN + JSON.stringify(spec);

function generated(spec: GenSpec): Variant {
  const anchors = spec.tempoOnly === true ? undefined : [{ at_ms: 0, bpm: spec.bpm }];
  const song: SceneSong = { bpm: spec.bpm, ...(anchors === undefined ? {} : { anchors }), ...(spec.moments === undefined ? {} : { moments: spec.moments }), ...(spec.lengthMs === undefined ? {} : { lengthMs: spec.lengthMs }) };
  const filler: SceneSong = { bpm: spec.bpm, ...(anchors === undefined ? {} : { anchors }) };
  const songs = Array.from({ length: spec.songIndex + 1 }, (_, i) => (i === spec.songIndex ? song : filler));
  const starts = songs.map((_, i) => (i === spec.songIndex ? spec.startMs : i * 1000));
  const intervals = [{ startMs: 0, zone: spec.zone }, ...(spec.changes ?? []).map((c) => ({ startMs: c.atMs, zone: c.zone }))].sort((a, b) => a.startMs - b.startMs);
  const cls: SceneClass = { songs, intervals, endMs: spec.startMs + (spec.lengthMs ?? 600_000) + 600_000 };
  return { cls, starts };
}

/** The same variant with its songs' anchors taken away. */
function tempoOnly(variant: Variant): Variant {
  return { ...variant, cls: { ...variant.cls, songs: variant.cls.songs.map((s): SceneSong => ({ ...(s.bpm === undefined ? {} : { bpm: s.bpm }), ...(s.moments === undefined ? {} : { moments: s.moments }), ...(s.lengthMs === undefined ? {} : { lengthMs: s.lengthMs }) })) } };
}

/** A lookup that answers the generated names beside the fixed variants. */
export function withGenerated(fixed: Readonly<Record<string, Variant>>): Readonly<Record<string, Variant>> {
  return new Proxy(fixed, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key.startsWith(GEN)) return generated(JSON.parse(key.slice(GEN.length)) as GenSpec);
      if (key.startsWith(TEMPO)) {
        const base = Object.entries(target).find(([name]) => name === key.slice(TEMPO.length));
        return base === undefined ? undefined : tempoOnly(base[1]);
      }
      return Object.entries(target).find(([name]) => name === key)?.[1];
    },
  });
}

export const tempoName = (variant: string): string => TEMPO + variant;
