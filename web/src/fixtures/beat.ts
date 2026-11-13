// For the beat dot's timing test only (not a state of the spec, so not screenshotted): the running
// class with the song that plays carrying beat anchors close to 180 BPM, the tempo changing 20 s in.
import type { RoomInput } from "../room/input.ts";
import { clockAt, linkAt } from "./build.ts";
import { STATE_FIXTURES } from "./states.ts";

const base = STATE_FIXTURES.running;
const doc = base.doc;
if (!doc) throw new Error("the running fixture has no class");
const songIndex = 5; // Neon Avenue
const song = doc.songs[songIndex];
const songs = doc.songs.map((s, i) =>
  i === songIndex ? { ...s, beat_anchors: { quality: "measured" as const, anchors: [{ at_ms: 0, bpm: 176 }, { at_ms: 20_000, bpm: 184 }] } } : s,
) as typeof doc.songs;
const drift = { ...doc, songs };
const view = clockAt(drift, song.start_ms + 10_000);

export const BEAT_DRIFT: RoomInput = { doc: drift, view, link: linkAt(view, "Locked") };
