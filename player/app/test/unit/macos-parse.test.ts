// The macOS reader's parser, on recorded outputs of the read script (test/fixtures/macos; the
// first samples are the spike's, written from osascript's documented output until the owner's
// run on a real Mac replaces them).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { matchCandidates } from "../../src/core/link/index.ts";
import type { LinkPlan } from "../../src/core/link/index.ts";
import { MAX_TEXT_LENGTH, parseMacOutput } from "../../src/core/link/macos-parse.ts";
import { MAC_MAX_OUTPUT_BYTES } from "../../src/core/link/macos-scripts.ts";
import { REPO } from "./fixtures.ts";

const fx = (name: string): string => readFileSync(join(REPO, "player", "app", "test", "fixtures", "macos", name), "utf8");
const AT = 1000;
const SEEN = 1040;

const READINGS: readonly [string, Record<string, unknown>][] = [
  ["playing.txt", { title: "Spike Song A", artist: "Spike Artist", lengthMs: 180_000, trackId: "spotify:track:SPIKEEXAMPLE0001", positionMs: 12_500, playing: true }],
  ["paused.txt", { title: "Spike Song B", artist: "Spike Artist", lengthMs: 200_000, trackId: "spotify:track:SPIKEEXAMPLE0002", positionMs: 61_250, playing: false }],
  ["unicode.txt", { title: "Äkta känsla – 夜 (Remix)", artist: "Björk & Sigur Rós", lengthMs: 215_466, trackId: "spotify:track:SPIKEEXAMPLE0003", positionMs: 0, playing: true }],
  ["local-file.txt", { title: "Warm up", artist: "", lengthMs: 95_000, trackId: "spotify:local:::Warm+up:95", positionMs: 3004, playing: true }],
  ["no-length.txt", { title: "Spike Song A", artist: "Spike Artist", lengthMs: null, trackId: null, positionMs: 1500, playing: true }],
];

for (const [file, want] of READINGS) {
  test(`recorded output ${file} becomes a reading that carries its own time`, () => {
    assert.deepEqual(parseMacOutput(fx(file), AT, SEEN), { kind: "reading", obs: { ...want, app: "Spotify", at: AT, seenAt: SEEN } });
  });
}

// Stopped is also what Spotify says for a moment between two songs, so it is marked `between`
// (issue #51, item 4): the reader holds what it had for one poll. Not running is not.
for (const [file, want] of [
  ["notrunning.txt", { kind: "closed" }],
  ["stopped.txt", { kind: "closed", between: true }],
] as const) {
  test(`recorded output ${file}: the music app is closed or has nothing loaded`, () => {
    assert.deepEqual(parseMacOutput(fx(file), AT, SEEN), want);
  });
}

test("playing with neither a title nor an artist is what Spotify says between two songs: marked, and still a reading", () => {
  const obs = { title: "", artist: "", lengthMs: null, trackId: null, app: "Spotify", positionMs: 0, playing: true, at: AT, seenAt: SEEN };
  assert.deepEqual(parseMacOutput("playing\t\t\t\t0\t0\n", AT, SEEN), { kind: "reading", obs, between: true });
  // Paused with nothing named, or playing with a title or an artist, is a reading as it stands.
  for (const out of ["paused\t\t\t\t0\t0\n", "playing\t\tT\t\t0\t0\n", "playing\t\t\tA\t0\t0\n"]) {
    const r = parseMacOutput(out, AT, SEEN);
    assert.equal(r.kind, "reading");
    assert.ok(!("between" in r), out);
  }
});

const GOOD = "playing\tspotify:track:X\tT\tA\t1.5\t180000\n";
const GARBAGE: readonly [string, string][] = [
  ["nothing", ""],
  ["only a newline", "\n"],
  ["an error message", "execution error: Spotify got an error: Connection is invalid. (-609)\n"],
  ["too few fields", "playing\tspotify:track:X\tT\tA\t1.5\n"],
  ["too many fields (a tab in a title)", "playing\tspotify:track:X\tT\tT2\tA\t1.5\t180000\n"],
  ["a field too many at the end", "playing\tspotify:track:X\tT\tA\t1.5\t180000\textra\n"],
  ["an unknown state", "fast forwarding\tspotify:track:X\tT\tA\t1.5\t180000\n"],
  ["the stopped state with fields", "stopped\tspotify:track:X\tT\tA\t1.5\t180000\n"],
  ["a position that is not a number", "playing\tspotify:track:X\tT\tA\tmissing value\t180000\n"],
  ["a negative position", "playing\tspotify:track:X\tT\tA\t-3\t180000\n"],
  ["an empty position", "playing\tspotify:track:X\tT\tA\t\t180000\n"],
  ["a hexadecimal position", "playing\tspotify:track:X\tT\tA\t0x10\t180000\n"],
  ["an infinite position", "playing\tspotify:track:X\tT\tA\tInfinity\t180000\n"],
  ["a position beyond a day", "playing\tspotify:track:X\tT\tA\t86401\t180000\n"],
  ["two lines", `${GOOD}${GOOD}`],
  ["a NUL byte", "playing\tspotify:track:X\tT\0\tA\t1.5\t180000\n"],
  ["more output than one line can be", `playing\tspotify:track:X\t${"T".repeat(MAC_MAX_OUTPUT_BYTES)}\tA\t1.5\t180000\n`],
  ["JSON", '{"state":"playing"}'],
];

for (const [label, out] of GARBAGE) {
  test(`garbage is refused, never guessed at: ${label}`, () => {
    assert.deepEqual(parseMacOutput(out, AT, SEEN), { kind: "garbage" });
  });
}

test("garbage of another type than text is refused as well", () => {
  for (const out of [null, undefined, 5, {}, Buffer.from(GOOD)]) assert.deepEqual(parseMacOutput(out as unknown as string, AT, SEEN), { kind: "garbage" });
});

test("the decimal mark may be a comma or a point, and a tiny position may come with an exponent", () => {
  const pos = (text: string): number | undefined => {
    const r = parseMacOutput(`paused\t\tT\tA\t${text}\t1000`, 0, 0);
    return r.kind === "reading" ? r.obs.positionMs : undefined;
  };
  assert.equal(pos("12,5"), 12_500);
  assert.equal(pos("12.5"), 12_500);
  assert.equal(pos("7"), 7000);
  assert.equal(pos("1.0E-3"), 1);
  assert.equal(pos("1,2,3"), undefined);
});

test("an unreadable length is left out, and long text is cut", () => {
  const r = parseMacOutput(`playing\tid\t${"T".repeat(900)}\t${"A".repeat(900)}\t1\tmissing value`, 0, 0);
  assert.equal(r.kind, "reading");
  if (r.kind !== "reading") return;
  assert.equal(r.obs.lengthMs, null);
  assert.equal(r.obs.title.length, MAX_TEXT_LENGTH);
  assert.equal(r.obs.artist.length, MAX_TEXT_LENGTH);
});

test("a parsed reading matches the class's song by id, or by title, artist and length", () => {
  const song = { index: 0, title: "Spike Song A", artist: "Spike Artist", lengthMs: 180_000, startMs: 0, endMs: 171_000, trackIds: ["SPIKEEXAMPLE0001"] };
  const plan: LinkPlan = { songs: [song], plannedCrossfadeMs: 9000, manualOnly: false };
  for (const file of ["playing.txt", "no-length.txt"]) {
    const r = parseMacOutput(fx(file), 0, 0);
    assert.equal(r.kind, "reading");
    if (r.kind === "reading") assert.deepEqual(matchCandidates(plan, r.obs, { lengthToleranceMs: 2500 }), [0]);
  }
});
