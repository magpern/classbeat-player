// The default demo class (scenario.ts, twenty-second intervals) in the words the text layer shows,
// so every existing screenshot carries its text. Fake data only.
import type { TextClass, TextInterval, TextSong } from "../src/text-types.ts";
import { TEXT_ZONES } from "./long-class.ts";
import { DEMO_CLASS, SONG_STARTS_MS } from "./scenario.ts";

const END = DEMO_CLASS.endMs;
const TITLES = [["Neon Avenue", "Pulse Theory"], ["Aurora Lane", "Night Signal"], ["Slow Fire", "Harbour Lights"]] as const;

const intervals: readonly TextInterval[] = DEMO_CLASS.intervals.map((iv, i) => ({
  startMs: iv.startMs, lengthMs: (DEMO_CLASS.intervals.at(i + 1)?.startMs ?? END) - iv.startMs, zone: iv.zone,
  name: TEXT_ZONES.find((z) => z.zone === iv.zone)?.name ?? "", cue: "Find the beat and hold it. Breathe out on every second bar.",
  cadence: { from: 70 + i * 2, to: 80 + i * 2 }, position: "seated", pattern: null,
}));

const songs: readonly TextSong[] = DEMO_CLASS.songs.map((s, i) => {
  const startMs = SONG_STARTS_MS.at(i) ?? 0;
  const [title, artist] = TITLES.at(i) ?? ["", ""];
  return { title, artist, startMs, lengthMs: (SONG_STARTS_MS.at(i + 1) ?? END) - startMs, ...s };
});

export const DEMO_TEXT: TextClass = { title: "Demo ride", endMs: END, zones: TEXT_ZONES, intervals, songs, segments: [{ startMs: 0, name: "Warm-up" }, { startMs: 40_000, name: "Main set" }], following: "Following Spotify" };
