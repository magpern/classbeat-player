// The Windows helper's output lines, parsed: table tests on output lines in the helper's format
// (the Spotify session playing and paused, the Store edition, no session, another app playing)
// and on everything else a helper could write.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_LINE_LENGTH, isSpotifySession, parseWindowsLine } from "../../src/core/link/windows-parse.ts";
import type { Observation } from "../../src/core/link/types.ts";
import { NO_SESSION, noSession, OTHER_APP, otherApp, sessionLine } from "./windows-harness.ts";

const AT = 50_000;
const BASE: Observation = { title: "Spike Song A", artist: "Spike Artist", lengthMs: 180_000, trackId: null, app: "Spotify.exe", positionMs: 12_500, playing: true, at: AT - 800, seenAt: AT };

const READINGS: readonly [string, string, Observation][] = [
  [
    "playing: the position is dated by the system's own age (800 ms)",
    '{"app":"Spotify.exe","status":"Playing","title":"Spike Song A","artist":"Spike Artist","positionMs":12500,"startMs":0,"endMs":180000,"lastUpdatedUtcMs":1794000000000,"nowUtcMs":1794000000800,"commands":0}',
    BASE,
  ],
  [
    "paused: the position is valid as it stands, however long ago it was updated",
    '{"app":"Spotify.exe","status":"Paused","title":"Spike Song B","artist":"Spike Artist","positionMs":61250,"startMs":0,"endMs":200000,"lastUpdatedUtcMs":1794000000000,"nowUtcMs":1794000090000,"commands":0}',
    { ...BASE, title: "Spike Song B", lengthMs: 200_000, positionMs: 61_250, playing: false, at: AT },
  ],
  [
    "letters outside ASCII arrive whole",
    '{"app":"Spotify.exe","status":"Playing","title":"Älskar dig – Sång å Köln","artist":"Björk","positionMs":42000,"startMs":0,"endMs":200000,"lastUpdatedUtcMs":1794000000000,"nowUtcMs":1794000000300,"commands":0}',
    { ...BASE, title: "Älskar dig – Sång å Köln", artist: "Björk", lengthMs: 200_000, positionMs: 42_000, at: AT - 300 },
  ],
  ["the Store edition's session id", sessionLine({ app: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" }), { ...BASE, app: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" }],
  ["the id in another case", sessionLine({ app: "SPOTIFY.EXE" }), { ...BASE, app: "SPOTIFY.EXE" }],
  ["a byte order mark and a carriage return around the line", `\uFEFF${sessionLine()}\r`, BASE],
  ["a position updated just under an hour ago is still dated by its age", sessionLine({ nowUtcMs: 1_794_003_599_999 }), { ...BASE, at: AT - 3_599_999 }],
  ["a position updated this instant", sessionLine({ nowUtcMs: 1_794_000_000_000 }), { ...BASE, at: AT }],
  ["paused, with a time the app never set: a paused position needs no age", sessionLine({ status: "Paused", lastUpdatedUtcMs: -11_644_473_600_000 }), { ...BASE, playing: false, at: AT }],
  ["another app playing while Spotify is not: its id only, with nothing to match", OTHER_APP, { title: "", artist: "", lengthMs: null, trackId: null, app: "Chrome", positionMs: 0, playing: true, at: AT, seenAt: AT }],
  [
    "another music app playing",
    '{"app":"Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic","status":"Playing","spotify":"","commands":0}',
    { title: "", artist: "", lengthMs: null, trackId: null, app: "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic", positionMs: 0, playing: true, at: AT, seenAt: AT },
  ],
  ["an app whose id only starts with the name is another app", '{"app":"SpotifyHelper.exe","status":"Playing","spotify":"Paused","commands":0}', { title: "", artist: "", lengthMs: null, trackId: null, app: "SpotifyHelper.exe", positionMs: 0, playing: true, at: AT, seenAt: AT }],
  ["no length from the system", sessionLine({ endMs: 0 }), { ...BASE, lengthMs: null }],
  ["no artist", sessionLine({ artist: null }), { ...BASE, artist: "" }],
  ["an empty title (an advert, say) is still a reading; it matches no song", sessionLine({ title: "" }), { ...BASE, title: "" }],
  ["closed is not playing", sessionLine({ status: "Closed" }), { ...BASE, playing: false, at: AT }],
  ["paused with neither a title nor an artist", sessionLine({ status: "Paused", title: "", artist: null }), { ...BASE, title: "", artist: "", playing: false, at: AT }],
];

for (const [name, line, want] of READINGS) {
  test(`reading: ${name}`, () => assert.deepEqual(parseWindowsLine(line, AT), { kind: "reading", observation: want, commands: 0 }));
}

// What Spotify reports for a moment between two songs is still a reading, as before (not
// playing), and marked `between`: the reader holds what it had for one poll (issue #51, item 4).
const OTHER: Observation = { title: "", artist: "", lengthMs: null, trackId: null, app: "Chrome", positionMs: 0, playing: true, at: AT, seenAt: AT };
const BETWEEN: readonly [string, string, Observation][] = [
  ["stopped is not playing", sessionLine({ status: "Stopped" }), { ...BASE, playing: false, at: AT }],
  ["changing track is not playing", sessionLine({ status: "Changing" }), { ...BASE, playing: false, at: AT }],
  ["opened is not playing", sessionLine({ status: "Opened" }), { ...BASE, playing: false, at: AT }],
  ["playing with neither a title nor an artist", sessionLine({ title: "", artist: null }), { ...BASE, title: "", artist: "" }],
  ["playing with an empty title and an empty artist", sessionLine({ title: "", artist: "" }), { ...BASE, title: "", artist: "" }],
  ["another app playing while Spotify changes track", otherApp("Chrome", "Changing"), OTHER],
  ["another app playing while Spotify is stopped", otherApp("Chrome", "Stopped"), OTHER],
  ["another app playing while Spotify has just opened a track", otherApp("Chrome", "Opened"), OTHER],
];

for (const [name, line, want] of BETWEEN) {
  test(`between two songs: ${name}`, () => assert.deepEqual(parseWindowsLine(line, AT), { kind: "reading", observation: want, commands: 0, between: true }));
}

test("another app playing while Spotify is paused, closed or not there is not between two songs", () => {
  for (const spotify of ["Paused", "Closed", ""]) assert.deepEqual(parseWindowsLine(otherApp("Chrome", spotify), AT), { kind: "reading", observation: OTHER, commands: 0 }, spotify);
});

test("every line says how many commands the helper has read, and it is passed on as it stands", () => {
  for (const n of [0, 1, 7, 1_000_000_000]) {
    assert.deepEqual(parseWindowsLine(sessionLine({ commands: n }), AT), { kind: "reading", observation: BASE, commands: n });
    assert.deepEqual(parseWindowsLine(noSession(n), AT), { kind: "none", commands: n });
    assert.deepEqual(parseWindowsLine(otherApp("Chrome", "Paused", n), AT), { kind: "reading", observation: OTHER, commands: n });
    assert.deepEqual(parseWindowsLine(sessionLine({ commands: n, nowUtcMs: 1_794_003_600_000 }), AT), { kind: "undated", commands: n });
  }
});

test("no reading: no Spotify session", () => assert.deepEqual(parseWindowsLine(NO_SESSION, AT), { kind: "none", commands: 0 }));

// Timing rule 8: a playing position whose age cannot be used says nothing about now. It is never
// dated "now" and followed; the line is undated and gives no reading, so the last good reading
// goes on aging (issue #51, item 2: as on macOS and Linux).
const UNDATED: readonly [string, string][] = [
  ["playing, the system clock moved back: the age is in the future", sessionLine({ nowUtcMs: 1_793_999_999_999 })],
  ["playing, last updated an hour ago", sessionLine({ nowUtcMs: 1_794_003_600_000 })],
  ["playing, last updated days ago", sessionLine({ nowUtcMs: 1_794_500_000_000 })],
  ["playing, with a time the app never set (the system's zero date)", sessionLine({ positionMs: 0, lastUpdatedUtcMs: -11_644_473_600_000 })],
];

for (const [name, line] of UNDATED) {
  test(`no reading: ${name}`, () => assert.deepEqual(parseWindowsLine(line, AT), { kind: "undated", commands: 0 }));
}

const GARBAGE: readonly [string, string][] = [
  ["nothing", ""],
  ["a bare word", "none"],
  ["a PowerShell error", "Await : timeout"],
  ["a cut-off line", sessionLine().slice(0, 60)],
  ["an array", "[]"],
  ["null", "null"],
  ["a string", '"Spotify.exe"'],
  ["the helper's own failure line", '{"error":true}'],
  ["no app field", '{"status":"Playing","title":"T"}'],
  ["no session, with more fields", '{"app":null,"title":"T","commands":0}'],
  ["no session, without the count of commands read", '{"app":null}'],
  ["a session without the count of commands read", sessionLine({ commands: undefined })],
  ["a count of commands that is text", sessionLine({ commands: "0" })],
  ["a negative count of commands", noSession(-1)],
  ["a count of commands that is not whole", noSession(0.5)],
  ["a count of commands beyond any real one", noSession(1_000_000_001)],
  ["a count of commands that is null", '{"app":null,"commands":null}'],
  ["an empty app", sessionLine({ app: "" })],
  ["an app that is not text", sessionLine({ app: 5 })],
  ["no title (the properties did not arrive)", sessionLine({ title: null })],
  ["a title that is not text", sessionLine({ title: { a: 1 } })],
  ["an artist that is not text", sessionLine({ artist: 7 })],
  ["a status that is not text", sessionLine({ status: true })],
  ["a position as text", sessionLine({ positionMs: "12500" })],
  ["a negative position", sessionLine({ positionMs: -1 })],
  ["a position past a day", sessionLine({ positionMs: 86_400_001 })],
  ["a number too large to be one", sessionLine().replace("12500", "1e999")],
  ["a missing time", sessionLine({ nowUtcMs: undefined })],
  ["a time that is not a number", sessionLine({ lastUpdatedUtcMs: "now" })],
  ["a start that is not a number", sessionLine({ startMs: null })],
  ["a title beyond any real one", sessionLine({ title: "x".repeat(1025) })],
  ["a line beyond the limit", sessionLine({ artist: "y".repeat(900), title: "x".repeat(900), status: "z".repeat(900) }).padEnd(MAX_LINE_LENGTH + 1, " ")],
  ["two objects on one line", `${NO_SESSION}${NO_SESSION}`],
  ["another app that is not playing", '{"app":"Chrome","status":"Paused","spotify":"Paused","commands":0}'],
  ["another app with no status", '{"app":"Chrome","spotify":"Paused","commands":0}'],
  ["another app carrying a title", '{"app":"Chrome","status":"Playing","spotify":"Paused","commands":0,"title":"Some video"}'],
  ["another app in the full session shape", sessionLine({ app: "Chrome" })],
  ["another app with an id beyond any real one", otherApp("c".repeat(1025))],
  ["another app without Spotify's own status", '{"app":"Chrome","status":"Playing","commands":0}'],
  ["another app while Spotify itself is said to play", otherApp("Chrome", "Playing")],
  ["another app with a Spotify status that is not text", '{"app":"Chrome","status":"Playing","spotify":null,"commands":0}'],
  ["another app without the count of commands read", '{"app":"Chrome","status":"Playing","spotify":"Paused"}'],
];

for (const [name, line] of GARBAGE) {
  test(`garbage: ${name}`, () => assert.deepEqual(parseWindowsLine(line, AT), { kind: "garbage" }));
}

test("the Spotify session is one of its two exact ids, whatever the case", () => {
  for (const id of ["Spotify.exe", "spotify.exe", "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"]) assert.equal(isSpotifySession(id), true, id);
  for (const id of ["Chrome", "MSEdge", "NotSpotify.exe", "", " Spotify.exe", "Spotify", "Spotify.exe.evil", "SpotifyHelper.exe", "SpotifyAB.SpotifyMusic_other!Spotify"]) {
    assert.equal(isSpotifySession(id), false, id);
  }
});

test("a line never changes what it claims by carrying extra fields", () => {
  const r = parseWindowsLine(sessionLine({ seenAt: 1, at: 2, trackId: "x", playing: false }), AT);
  assert.deepEqual(r, { kind: "reading", observation: BASE, commands: 0 });
});
