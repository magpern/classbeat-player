// Matching a reading to the class's songs (ADR 0001: title, artist and length, in the class's
// order; provider ids only where the operating system gives them), and the class's own plan.
import assert from "node:assert/strict";
import { test } from "node:test";
import { artistMatches, DEFAULT_LINK_CONFIG, linkPlanFrom, matchCandidates, norm, normalizeId } from "../../src/core/link/index.ts";
import type { LinkPlan, Observation } from "../../src/core/link/index.ts";
import { loadExample } from "./fixtures.ts";

const song = (index: number, title: string, artist: string, lengthMs: number, trackIds: string[] = []) => ({ index, title, artist, lengthMs, startMs: index * 1000, endMs: index * 1000 + 900, trackIds });
const plan: LinkPlan = {
  plannedCrossfadeMs: 9000,
  manualOnly: false,
  songs: [
    song(0, "Älskar dig – Sång å Köln", "Björk", 200_000),
    song(1, "Levels", "Avicii", 200_000, ["5UqCQaDshqbIk3pkhy4Pjg"]),
    song(2, "Levels", "Avicii", 200_000, ["5UqCQaDshqbIk3pkhy4Pjg"]),
    song(3, "One More Time", "Daft Punk", 320_000),
  ],
};
const obs = (o: Partial<Observation>): Observation => ({ title: "", artist: "", positionMs: 0, playing: true, at: 0, seenAt: 0, ...o });
const match = (o: Partial<Observation>): number[] => matchCandidates(plan, obs(o), DEFAULT_LINK_CONFIG);

test("ids: every form the systems give becomes the bare id", () => {
  for (const form of ["5UqCQaDshqbIk3pkhy4Pjg", "spotify:track:5UqCQaDshqbIk3pkhy4Pjg", "/com/spotify/track/5UqCQaDshqbIk3pkhy4Pjg", "https://open.spotify.com/track/5UqCQaDshqbIk3pkhy4Pjg?si=abc"]) {
    assert.equal(normalizeId(form), "5UqCQaDshqbIk3pkhy4Pjg", form);
  }
});

test("text: case, accents and punctuation do not matter", () => {
  assert.equal(norm("Älskar dig – Sång å Köln"), norm("ALSKAR DIG  SANG A KOLN"));
  assert.equal(artistMatches("Avicii", "AVICII"), true);
});

test("artists: one of several matches, a part of a word does not, empty never does", () => {
  assert.equal(artistMatches("Avicii", "Avicii, Aloe Blacc"), true);
  assert.equal(artistMatches("Avicii feat. Aloe Blacc", "Avicii"), true);
  assert.equal(artistMatches("Abba", "A"), false);
  assert.equal(artistMatches("Avicii", ""), false);
  assert.equal(artistMatches("", ""), false);
});

const CASES: readonly { name: string; reading: Partial<Observation>; expected: number[] }[] = [
  { name: "title, artist and length", reading: { title: "One More Time", artist: "Daft Punk", lengthMs: 320_000 }, expected: [3] },
  { name: "a title with non-ASCII letters", reading: { title: "Älskar dig – Sång å Köln", artist: "Björk", lengthMs: 200_000 }, expected: [0] },
  { name: "a length within 2.5 s of the class's", reading: { title: "One More Time", artist: "Daft Punk", lengthMs: 322_500 }, expected: [3] },
  { name: "a length over 2.5 s off: another recording", reading: { title: "One More Time", artist: "Daft Punk", lengthMs: 322_501 }, expected: [] },
  { name: "a length not reported is not checked", reading: { title: "One More Time", artist: "Daft Punk", lengthMs: null }, expected: [3] },
  { name: "the same recording twice gives both candidates", reading: { title: "Levels", artist: "Avicii", lengthMs: 200_000 }, expected: [1, 2] },
  { name: "the provider id wins over a different title", reading: { title: "Levels (Radio Edit)", artist: "Avicii", trackId: "spotify:track:5UqCQaDshqbIk3pkhy4Pjg" }, expected: [1, 2] },
  { name: "an id the class does not know falls back to the text", reading: { title: "One More Time", artist: "Daft Punk", trackId: "spotify:track:other", lengthMs: 320_000 }, expected: [3] },
  { name: "another song", reading: { title: "Around the World", artist: "Daft Punk", lengthMs: 320_000 }, expected: [] },
  { name: "the same title by another artist", reading: { title: "Levels", artist: "Skrillex", lengthMs: 200_000 }, expected: [] },
  { name: "no artist reported", reading: { title: "Levels", artist: "", lengthMs: 200_000 }, expected: [] },
  { name: "no title reported", reading: { title: "", artist: "Avicii" }, expected: [] },
  { name: "another app playing, even with a class song's title", reading: { title: "One More Time", artist: "Daft Punk", lengthMs: 320_000, app: "chrome.exe" }, expected: [] },
  { name: "the Spotify app on Windows", reading: { title: "One More Time", artist: "Daft Punk", lengthMs: 320_000, app: "Spotify.exe" }, expected: [3] },
];
for (const c of CASES) test(`matching: ${c.name}`, () => assert.deepEqual(match(c.reading), c.expected));

test("the class's plan: song windows as stated, ids as bare ids, planned crossfade", () => {
  const doc = loadExample("valid/class-45min-crossfade-9s.json");
  const p = linkPlanFrom(doc);
  assert.equal(p.manualOnly, false);
  assert.equal(p.plannedCrossfadeMs, 9000);
  assert.equal(p.songs.length, doc.songs.length);
  assert.deepEqual(p.songs.map((s) => [s.startMs, s.endMs]), doc.songs.map((s) => [s.start_ms, s.end_ms]));
  assert.deepEqual(p.songs.map((s) => s.title), doc.songs.map((s) => s.title));
  for (const [i, s] of doc.songs.entries()) {
    assert.deepEqual(p.songs[i].trackIds, s.ids?.spotify_track ? [normalizeId(s.ids.spotify_track)] : []);
  }
});

test("the class's plan: no music, or song timing missing, is manual only with no windows", () => {
  for (const name of ["valid/short-class-no-music.json", "valid/class-song-timing-missing.json"]) {
    const p = linkPlanFrom(loadExample(name));
    assert.equal(p.manualOnly, true, name);
    assert.deepEqual(p.songs, []);
  }
});
