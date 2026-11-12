// Another player on the bus (ADR 0001): one that plays while Spotify does not is reported as
// another app (off the list), never followed and never commanded. A fake execFile: nothing here
// starts a process. What a player that hangs or fails does is in test/unit/linux-hung-players.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { matchCandidates } from "../../src/core/link/index.ts";
import { isOtherPlayer, LINUX_CALLS, MAX_OTHER_PLAYERS, otherPlayerArgs } from "../../src/core/link/linux-calls.ts";
import { parseLinuxOutput, parseOtherPlayers } from "../../src/core/link/linux-parse.ts";
import { createController } from "../../src/main/controller.ts";
import { converterExamples } from "./fixtures.ts";
import { bus, FAILED, FIREFOX, LIST, names, other, PAUSED, PLAN, PLAYING, READ, STOPPED, VLC } from "./linux-bus.ts";

test("while Spotify plays, nothing else is asked: no names, no other player", () => {
  const b = bus({ spotify: PLAYING, players: { [VLC]: PLAYING } });
  b.linux.setActive(true);
  b.poll();
  assert.deepEqual(b.asked, [READ, READ]);
  assert.equal(b.linux.latest(0)?.app, "Spotify");
});

for (const [label, spotify] of [
  ["paused", PAUSED],
  ["with nothing loaded", STOPPED],
  ["not running", FAILED],
  ["answering garbage", "garbage\n"],
] as const) {
  test(`Spotify ${label} and another player playing: reported as another app, which is off the list`, () => {
    const b = bus({ spotify: spotify, players: { [VLC]: PLAYING } });
    b.clock.t = 500;
    b.linux.setActive(true);
    assert.deepEqual(b.asked, [READ, LIST, other(VLC)]);
    const obs = b.linux.latest(500);
    assert.ok(obs);
    // The player's bus name and nothing else (as the Windows reader reports another app).
    assert.deepEqual(obs, { title: "", artist: "", lengthMs: null, trackId: null, app: VLC, positionMs: 0, playing: true, at: 500, seenAt: 500 });
    // It plays the very recording the class holds: still not followed.
    assert.deepEqual(matchCandidates(PLAN, obs, { lengthToleranceMs: 2500 }), []);
    const own = parseLinuxOutput(PLAYING, 0, 0);
    assert.deepEqual(matchCandidates(PLAN, own.kind === "reading" ? own.obs : assert.fail(), { lengthToleranceMs: 2500 }), [0], "Spotify's own reading of it is followed");
  });
}

test("a player whose name merely contains Spotify's is another player too", () => {
  for (const name of ["org.mpris.MediaPlayer2.spotifyd", "org.mpris.MediaPlayer2.spotify.instance7", "org.mpris.MediaPlayer2.Spotify", "org.mpris.MediaPlayer2.spotify_player"]) {
    const b = bus({ spotify: FAILED, players: { [name]: PLAYING } });
    b.linux.setActive(true);
    assert.deepEqual(b.asked, [READ, LIST, other(name)], name);
    const obs = b.linux.latest(0);
    assert.deepEqual([obs?.app, obs?.title, obs?.trackId], [name, "", null], name);
    assert.deepEqual(matchCandidates(PLAN, obs ?? assert.fail(), { lengthToleranceMs: 2500 }), [], `${name} is never followed`);
  }
});

test("another player that does not play changes nothing: Spotify's own paused reading stands", () => {
  const b = bus({ spotify: PAUSED, players: { [VLC]: PAUSED, [FIREFOX]: STOPPED, "org.mpris.MediaPlayer2.mpv": FAILED, "org.mpris.MediaPlayer2.x": "garbage" } });
  b.linux.setActive(true);
  assert.deepEqual(b.asked, [READ, LIST, other(VLC), other(FIREFOX), other("org.mpris.MediaPlayer2.mpv"), other("org.mpris.MediaPlayer2.x")]);
  const obs = b.linux.latest(0);
  assert.deepEqual([obs?.app, obs?.playing, obs?.positionMs], ["Spotify", false, 61_250]);
});

test("the first other player that plays is taken; when it stops, Spotify's reading is back; when Spotify plays, it is followed again", () => {
  const b = bus({ spotify: PAUSED, players: { [VLC]: PAUSED, [FIREFOX]: PLAYING } });
  b.linux.setActive(true);
  assert.equal(b.linux.latest(0)?.app, FIREFOX);
  b.state.players = { [VLC]: PAUSED, [FIREFOX]: PAUSED };
  b.poll();
  assert.equal(b.linux.latest(0)?.app, "Spotify");
  b.state.players = { [VLC]: PLAYING };
  b.state.spotify = PLAYING;
  b.poll();
  assert.deepEqual([b.linux.latest(0)?.app, b.linux.latest(0)?.playing], ["Spotify", true]);
});

test("Spotify gone and nothing else playing: the last reading is kept and ages (rule 8)", () => {
  const b = bus({ spotify: PLAYING });
  b.linux.setActive(true);
  const good = b.linux.latest(0);
  for (const list of [undefined, FAILED, "garbage", names([]), '{"type":"as","data":[]}', '{"type":"a{sv}","data":[["org.mpris.MediaPlayer2.vlc"]]}']) {
    b.state.spotify = FAILED;
    b.state.players = { [VLC]: PLAYING };
    b.state.list = list === undefined ? names(["org.freedesktop.DBus"]) : list;
    b.clock.t += 250;
    b.poll();
    assert.equal(b.linux.latest(b.clock.t), good, String(list));
  }
  assert.ok(!b.asked.includes(other(VLC)), "a player the bus did not list is never asked");
});

test("only well-formed player names the bus listed are asked, at most four, and nothing they say is run", () => {
  const hostile = [
    "org.mpris.MediaPlayer2.spotify",
    "org.mpris.MediaPlayer2.",
    "org.mpris.MediaPlayer2.-x",
    "org.mpris.MediaPlayer2.a b",
    "org.mpris.MediaPlayer2.a;b",
    "org.mpris.MediaPlayer2.a$(x)",
    "org.mpris.MediaPlayer2.a\n",
    " org.mpris.MediaPlayer2.a",
    "--system",
    "--auto-start=yes",
    "org.freedesktop.systemd1",
    "org.mpris.MediaPlayer2",
    "com.example.org.mpris.MediaPlayer2.a",
    `org.mpris.MediaPlayer2.${"a".repeat(200)}`,
    ":1.99",
    "",
    5,
    null,
    ["org.mpris.MediaPlayer2.a"],
    { toString: () => "org.mpris.MediaPlayer2.a" },
  ];
  for (const name of hostile) {
    assert.equal(isOtherPlayer(name), false, JSON.stringify(name));
    assert.equal(otherPlayerArgs(name as string), null, JSON.stringify(name));
  }
  assert.deepEqual(parseOtherPlayers(names(hostile)), []);
  const many = ["a", "b", "c", "d", "e", "f"].map((x) => `org.mpris.MediaPlayer2.${x}`);
  assert.equal(MAX_OTHER_PLAYERS, 4);
  assert.deepEqual(parseOtherPlayers(names([...hostile, ...many])), many.slice(0, 4));
  for (const bad of ["", "{", "null", "[]", 5, null, '{"type":"as","data":"x"}', '{"type":"as","data":[{"0":"org.mpris.MediaPlayer2.a"}]}']) assert.deepEqual(parseOtherPlayers(bad as string), [], String(bad));

  const args = otherPlayerArgs(VLC);
  assert.deepEqual(args, ["--user", "--no-pager", "--auto-start=no", "--timeout=500ms", "--json=short", "call", VLC, "/org/mpris/MediaPlayer2", "org.freedesktop.DBus.Properties", "GetAll", "s", "org.mpris.MediaPlayer2.Player"]);
  assert.ok(Object.isFrozen(args));

  const b = bus({ spotify: FAILED, list: names([...hostile, ...many]) });
  b.linux.setActive(true);
  assert.deepEqual(b.asked, [READ, LIST, ...many.slice(0, 4).map(other)]);
  for (const run of b.runs) assert.ok(run === LINUX_CALLS.read || run === LINUX_CALLS.names || (run.length === 12 && run.at(-3) === "GetAll"), run.join(" "));
});

test("commands go to Spotify's name only, whatever else plays: there is no command for another player", () => {
  const b = bus({ spotify: PAUSED, players: { [VLC]: PLAYING } });
  b.linux.setActive(true);
  assert.equal(b.linux.latest(0)?.app, VLC);
  const before = b.runs.length;
  for (const action of ["play", "pause", "next"] as const) b.linux.send(action);
  assert.deepEqual(b.runs.slice(before), [LINUX_CALLS.play, LINUX_CALLS.pause, LINUX_CALLS.next]);
  for (const run of b.runs) {
    const method = run.at(-1);
    if (method === "Play" || method === "Pause" || method === "Next") assert.equal(run[run.indexOf("call") + 1], "org.mpris.MediaPlayer2.spotify");
    else assert.ok(method === "org.mpris.MediaPlayer2.Player" || method === "ListNames", method);
  }
});

test("in the shell: another player playing shows Off the list within 3 s, and Spotify playing a class song locks again", () => {
  const text = readFileSync(converterExamples()[0], "utf8");
  const first = JSON.parse(text).songs[0] as { title: string; artist: string; length_ms: number };
  const classSong = PLAYING.replace("Spike Song A", first.title).replace('["Spike Artist"]},"xesam:autoRating', `[${JSON.stringify(first.artist)}]},"xesam:autoRating`).replace("180000000", String(first.length_ms * 1000));
  const b = bus({ spotify: classSong });
  const c = createController(() => b.clock.t, b.linux, b.linux);
  c.open("a.json", text);
  c.command({ type: "follow" });
  assert.equal(c.snapshot().link?.state, "Locked");
  // Spotify is paused and another player plays the same recording.
  b.state.spotify = classSong.replace('"Playing"', '"Paused"');
  b.state.players = { [VLC]: classSong };
  b.clock.t = 250;
  b.poll();
  assert.equal(c.snapshot().link?.state, "Off the list");
  b.state.spotify = classSong;
  b.clock.t = 500;
  b.poll();
  assert.equal(c.snapshot().link?.state, "Locked");
  c.stop();
});
