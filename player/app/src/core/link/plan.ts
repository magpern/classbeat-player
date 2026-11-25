// What the music link needs from a class document: the songs with their windows and ids.
// Pure: no I/O. Song windows are used as the class states them (ADR 0001 rule 1).
import type { Class } from "../../../../../schema/generated/ts/class.d.ts";
import { classMixOf } from "../mix/class-mix.ts";
import { normalizeId } from "./match.ts";
import type { LinkPlan } from "./types.ts";

export function linkPlanFrom(doc: Class): LinkPlan {
  // A Swedebeat class that names a mix never uses the Spotify music link (rule 3, ADR 0013 section 4):
  // its clock is the mix's audio or the manual clock (core/mix/mode-policy.ts).
  const mixClass = doc.music.source === "swedebeat" && classMixOf(doc.music) !== null;
  const manualOnly = doc.music.source === "none" || doc.music.song_timing === "missing" || mixClass;
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
