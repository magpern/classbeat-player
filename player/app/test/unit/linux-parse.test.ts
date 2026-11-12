// The Linux reader's parser, on recorded outputs of the read call (test/fixtures/linux). The
// samples are busctl's real output (systemd 255), recorded on a private session bus from a
// stand-in player that answers the way MPRIS specifies, until the owner's run with the real
// Spotify app on Linux replaces them. old-id, no-length and no-track are edits of playing.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { matchCandidates } from "../../src/core/link/index.ts";
import type { LinkPlan } from "../../src/core/link/index.ts";
import { LINUX_MAX_OUTPUT_BYTES } from "../../src/core/link/linux-calls.ts";
import { MAX_TEXT_LENGTH, parseLinuxOutput } from "../../src/core/link/linux-parse.ts";
import { REPO } from "./fixtures.ts";

const fx = (name: string): string => readFileSync(join(REPO, "player", "app", "test", "fixtures", "linux", name), "utf8");
const AT = 1000;
const SEEN = 1040;

const READINGS: readonly [string, Record<string, unknown>][] = [
  ["playing.json", { title: "Spike Song A", artist: "Spike Artist", lengthMs: 180_000, trackId: "/com/spotify/track/SPIKEEXAMPLE0001", positionMs: 12_500, playing: true }],
  // An object path for the id, a signed length, two artists, and text that JSON has to escape.
  ["paused.json", { title: 'Äkta känsla – 夜 "Remix"\t\\ x', artist: "Spike Artist, Second Artist", lengthMs: 200_000, trackId: "/com/spotify/track/SPIKEEXAMPLE0002", positionMs: 61_250, playing: false }],
  ["old-id.json", { title: "Spike Song A", artist: "Spike Artist", lengthMs: 180_000, trackId: "spotify:track:SPIKEEXAMPLE0001", positionMs: 1500, playing: true }],
  ["no-length.json", { title: "Spike Song A", artist: "Spike Artist", lengthMs: null, trackId: null, positionMs: 12_500, playing: true }],
  ["no-track.json", { title: "Spike Song A", artist: "Spike Artist", lengthMs: null, trackId: null, positionMs: 12_500, playing: true }],
];

for (const [file, want] of READINGS) {
  test(`recorded output ${file} becomes a reading that carries its own time`, () => {
    assert.deepEqual(parseLinuxOutput(fx(file), AT, SEEN), { kind: "reading", obs: { ...want, app: "Spotify", at: AT, seenAt: SEEN } });
  });
}

// Stopped is also what a player says for a moment between two songs, so it is marked
// `between` (issue #51, item 4): the reader holds what it had for one poll.
test("recorded output stopped.json: the music app has nothing loaded", () => {
  assert.deepEqual(parseLinuxOutput(fx("stopped.json"), AT, SEEN), { kind: "closed", between: true });
});

const s = (data: unknown): unknown => ({ type: "s", data });
const META = { "xesam:title": s("T"), "xesam:artist": { type: "as", data: ["A"] }, "mpris:length": { type: "t", data: 180_000_000 }, "mpris:trackid": s("spotify:track:X") };
const PROPS = { PlaybackStatus: s("Playing"), Position: { type: "x", data: 1_500_000 }, Metadata: { type: "a{sv}", data: META } };
const answer = (props: unknown): string => `${JSON.stringify({ type: "a{sv}", data: [props] })}\n`;
const withProp = (key: string, v: unknown): string => answer({ ...PROPS, [key]: v });
const withMeta = (key: string, v: unknown): string => withProp("Metadata", { type: "a{sv}", data: { ...META, [key]: v } });
const without = (o: Record<string, unknown>, key: string): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const GOOD = answer(PROPS);

test("the hand-built answer the garbage cases are cut from is itself a reading", () => {
  assert.deepEqual(parseLinuxOutput(GOOD, AT, SEEN), {
    kind: "reading",
    obs: { title: "T", artist: "A", lengthMs: 180_000, trackId: "spotify:track:X", app: "Spotify", positionMs: 1500, playing: true, at: AT, seenAt: SEEN },
  });
});

const GARBAGE: readonly [string, string][] = [
  ["nothing", ""],
  ["only a newline", "\n"],
  ["busctl's error text", 'Call failed: Name "org.mpris.MediaPlayer2.spotify" does not exist\n'],
  ["JSON cut short", GOOD.slice(0, GOOD.length - 8)],
  ["two answers", `${GOOD}${GOOD}`],
  ["JSON that is not an object", "[1,2,3]"],
  ["JSON null", "null"],
  ["another signature at the top", GOOD.replace('{"type":"a{sv}"', '{"type":"v"')],
  ["no properties", JSON.stringify({ type: "a{sv}", data: [] })],
  ["two property dictionaries", JSON.stringify({ type: "a{sv}", data: [PROPS, PROPS] })],
  ["properties that are a list", JSON.stringify({ type: "a{sv}", data: [[PROPS]] })],
  ["properties not in a list", JSON.stringify({ type: "a{sv}", data: PROPS })],
  ["no playback status", answer(without(PROPS, "PlaybackStatus"))],
  ["an unknown playback status", withProp("PlaybackStatus", s("Seeking"))],
  ["a playback status in other letters", withProp("PlaybackStatus", s("playing"))],
  ["a playback status that is not text", withProp("PlaybackStatus", { type: "b", data: true })],
  ["a playback status under another signature", withProp("PlaybackStatus", { type: "o", data: "Playing" })],
  ["a playback status without its wrapping", withProp("PlaybackStatus", "Playing")],
  ["no position", answer(without(PROPS, "Position"))],
  ["a position as text", withProp("Position", { type: "x", data: "1500000" })],
  ["a position of another type", withProp("Position", { type: "d", data: 1.5 })],
  ["a position under another signature", withProp("Position", { type: "t", data: 1_500_000 })],
  ["a negative position", withProp("Position", { type: "x", data: -1 })],
  ["a position with a fraction", withProp("Position", { type: "x", data: 1.5 })],
  ["a position beyond a day", withProp("Position", { type: "x", data: 86_400_000_001 })],
  ["a position too large to be exact", GOOD.replace('"data":1500000', '"data":9223372036854775807')],
  ["a position with no value", withProp("Position", { type: "x" })],
  ["no metadata", answer(without(PROPS, "Metadata"))],
  ["metadata that is a list", withProp("Metadata", { type: "a{sv}", data: [META] })],
  ["metadata of another type", withProp("Metadata", { type: "s", data: "T" })],
  ["metadata under another signature", withProp("Metadata", { type: "a{ss}", data: META })],
  ["a title that is not text", withMeta("xesam:title", { type: "s", data: 5 })],
  ["a title of another type", withMeta("xesam:title", { type: "as", data: ["T"] })],
  ["a title under another signature", withMeta("xesam:title", { type: "o", data: "T" })],
  ["artists under another signature", withMeta("xesam:artist", { type: "ao", data: ["A"] })],
  ["a title without its wrapping", withMeta("xesam:title", "T")],
  ["a title with a NUL", withMeta("xesam:title", s("T\0"))],
  ["artists as one text", withMeta("xesam:artist", s("A"))],
  ["an artist that is not text", withMeta("xesam:artist", { type: "as", data: ["A", 5] })],
  ["artists that are no list", withMeta("xesam:artist", { type: "as", data: { 0: "A" } })],
  ["more output than one answer can be", withMeta("xesam:title", s("T".repeat(LINUX_MAX_OUTPUT_BYTES)))],
];

for (const [label, out] of GARBAGE) {
  test(`garbage is refused, never guessed at: ${label}`, () => {
    assert.deepEqual(parseLinuxOutput(out, AT, SEEN), { kind: "garbage" });
  });
}

test("garbage of another type than text is refused as well", () => {
  for (const out of [null, undefined, 5, {}, JSON.parse(GOOD), Buffer.from(GOOD)]) assert.deepEqual(parseLinuxOutput(out as unknown as string, AT, SEEN), { kind: "garbage" });
});

test("a stopped player is closed whatever else it says", () => {
  assert.deepEqual(parseLinuxOutput(answer({ PlaybackStatus: s("Stopped") }), AT, SEEN), { kind: "closed", between: true });
  assert.deepEqual(parseLinuxOutput(withProp("PlaybackStatus", s("Stopped")), AT, SEEN), { kind: "closed", between: true });
});

const obsOf = (out: string) => {
  const r = parseLinuxOutput(out, 0, 0);
  return r.kind === "reading" ? r.obs : assert.fail(`not a reading: ${out}`);
};

test("positions and lengths are microseconds, rounded to milliseconds", () => {
  assert.equal(obsOf(withProp("Position", { type: "x", data: 0 })).positionMs, 0);
  assert.equal(obsOf(withProp("Position", { type: "x", data: 1_234_567 })).positionMs, 1235);
  assert.equal(obsOf(withProp("Position", { type: "x", data: 86_400_000_000 })).positionMs, 86_400_000);
  assert.equal(obsOf(withMeta("mpris:length", { type: "x", data: 215_466_400 })).lengthMs, 215_466);
});

test("a title or artist the player does not state is empty, and matches nothing", () => {
  const bare = obsOf(withProp("Metadata", { type: "a{sv}", data: {} }));
  assert.deepEqual([bare.title, bare.artist, bare.lengthMs, bare.trackId], ["", "", null, null]);
  assert.equal(obsOf(withMeta("xesam:artist", { type: "as", data: [] })).artist, "");
});

test("playing with neither a title nor an artist is what a player says between two songs: marked, and still a reading", () => {
  const empty = { type: "a{sv}", data: {} };
  const bare = parseLinuxOutput(withProp("Metadata", empty), AT, SEEN);
  assert.deepEqual(bare, { kind: "reading", obs: { title: "", artist: "", lengthMs: null, trackId: null, app: "Spotify", positionMs: 1500, playing: true, at: AT, seenAt: SEEN }, between: true });
  // Paused with nothing named, or playing with a title or an artist, is a reading as it stands.
  for (const out of [answer({ ...PROPS, PlaybackStatus: s("Paused"), Metadata: empty }), withMeta("xesam:title", s("")), withMeta("xesam:artist", { type: "as", data: [] }), GOOD]) {
    const r = parseLinuxOutput(out, AT, SEEN);
    assert.equal(r.kind, "reading");
    assert.ok(!("between" in r), out);
  }
});

test("an unreadable length or id is left out, and long text is cut", () => {
  for (const bad of [{ type: "s", data: "180000000" }, { type: "t", data: -5 }, { type: "t", data: 0 }, { type: "d", data: 1.8e8 }, { type: "u", data: 180_000_000 }, { type: "t", data: 1.5 }, 180_000_000]) {
    assert.equal(obsOf(withMeta("mpris:length", bad)).lengthMs, null, JSON.stringify(bad));
  }
  for (const bad of [{ type: "s", data: "" }, { type: "s", data: 5 }, { type: "as", data: ["x"] }, { type: "g", data: "spotify:track:X" }, { type: "o", data: "/org/mpris/MediaPlayer2/TrackList/NoTrack" }, "spotify:track:X"]) {
    assert.equal(obsOf(withMeta("mpris:trackid", bad)).trackId, null, JSON.stringify(bad));
  }
  const long = obsOf(answer({ ...PROPS, Metadata: { type: "a{sv}", data: { "xesam:title": s("T".repeat(900)), "xesam:artist": { type: "as", data: ["A".repeat(900)] }, "mpris:trackid": s("i".repeat(900)) } } }));
  assert.deepEqual([long.title.length, long.artist.length, long.trackId?.length], [MAX_TEXT_LENGTH, MAX_TEXT_LENGTH, MAX_TEXT_LENGTH]);
});

test("properties the reader does not use are ignored, whatever they hold", () => {
  const extra = answer({ ...PROPS, Volume: { type: "d", data: 1 }, Rate: "fast", CanControl: null, __proto__x: s("Paused") });
  assert.deepEqual(obsOf(extra), obsOf(GOOD));
});

test("a parsed reading matches the class's song by id, or by title, artist and length", () => {
  const song = { index: 0, title: "Spike Song A", artist: "Spike Artist", lengthMs: 180_000, startMs: 0, endMs: 171_000, trackIds: ["SPIKEEXAMPLE0001"] };
  const plan: LinkPlan = { songs: [song], plannedCrossfadeMs: 9000, manualOnly: false };
  for (const file of ["playing.json", "old-id.json", "no-length.json", "no-track.json"]) assert.deepEqual(matchCandidates(plan, obsOf(fx(file)), { lengthToleranceMs: 2500 }), [0], file);
});
