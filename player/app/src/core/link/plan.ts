// What the music link needs from a class document: the songs with their windows and ids.
// Pure: no I/O. Song windows are used as the class states them (ADR 0001 rule 1).
import type { Class } from "../../../../../schema/generated/ts/class.d.ts";
import { normalizeId } from "./match.ts";
import type { LinkPlan } from "./types.ts";

export function linkPlanFrom(doc: Class): LinkPlan {
  const manualOnly = doc.music.source === "none" || doc.music.song_timing === "missing";
  return {
    manualOnly,
    plannedCrossfadeMs: doc.music.design_crossfade_ms,
    songs: manualOnly
      ? []
      : doc.songs.map((s, index) => ({
          index,
          title: s.title,
          artist: s.artist,
          lengthMs: s.length_ms,
          startMs: s.start_ms,
          endMs: s.end_ms,
          trackIds: s.ids?.spotify_track ? [normalizeId(s.ids.spotify_track)] : [],
        })),
  };
}
