// Three things the Linux reader must get right beside following Spotify (ADR 0001, rule 8):
// another player that plays is reported as another app (off the list), never followed and never
// commanded; a reading whose time cannot be told is never dated "now"; and no command is sent
// before Spotify's first good reading. A fake execFile: nothing here starts a process.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isCurrent, matchCandidates } from "../../src/core/link/index.ts";
import type { LinkPlan } from "../../src/core/link/index.ts";
import { BUSCTL, isOtherPlayer, LINUX_CALLS, MAX_OTHER_PLAYERS, otherPlayerArgs } from "../../src/core/link/linux-calls.ts";
import { asOtherPlayer, OTHER_PLAYER, parseLinuxOutput, parseOtherPlayers } from "../../src/core/link/linux-parse.ts";
import { createController } from "../../src/main/controller.ts";
import { createLinuxMusic } from "../../src/main/linux-reader.ts";
import type { ExecFileFn } from "../../src/main/linux-reader.ts";
import { converterExamples, REPO } from "./fixtures.ts";

const fx = (name: string): string => readFileSync(join(REPO, "player", "app", "test", "fixtures", "linux", name), "utf8");
const PLAYING = fx("playing.json");
const PAUSED = fx("paused.json");
const STOPPED = fx("stopped.json");
const VLC = "org.mpris.MediaPlayer2.vlc";
const FIREFOX = "org.mpris.MediaPlayer2.firefox.instance_1_84";
const names = (list: readonly unknown[]): string => `${JSON.stringify({ type: "as", data: [list] })}\n`;
const FAILED = Object.assign(new Error("Call failed"), { code: 1 });

type Answer = string | Error | null;

/**
 * A session bus with Spotify and other players. `spotify` and each player's entry are what the
 * read call gets: text, an error, or null for a call left unanswered. Commands are answered at
 * once. `asked` lists every call made, by its destination and last argument.
 */
function bus(state: { spotify: Answer; players?: Record<string, Answer>; list?: Answer }) {
  const asked: string[] = [];
  const runs: (readonly string[])[] = [];
  const clock = { t: 0, step: 0 };
  let poll: () => void = () => undefined;
  const reply = (a: Answer, done: (e: Error | null, out: string) => void): void => {
    clock.t += clock.step;
    if (a === null) return;
    if (typeof a === "string") done(null, a);
    else done(a, "");
  };
  const exec: ExecFileFn = (file, args, _options, done) => {
    assert.equal(file, BUSCTL);
    runs.push(args);
    const dest = args[args.indexOf("call") + 1];
    asked.push(`${dest} ${args.at(-1)}`);
    if (args === LINUX_CALLS.names) return reply(state.list === undefined ? names(["org.freedesktop.DBus", ":1.4", "org.mpris.MediaPlayer2.spotify", ...Object.keys(state.players ?? {})]) : state.list, done);
    if (args === LINUX_CALLS.read) return reply(state.spotify, done);
    if (dest === "org.mpris.MediaPlayer2.spotify") return done(null, "");
    reply(state.players?.[dest] ?? FAILED, done);
  };
  const linux = createLinuxMusic({ exec, now: () => clock.t, every: (fn) => ((poll = fn), () => undefined) });
  return { linux, asked, runs, clock, state, poll: () => poll() };
}

const READ = "org.mpris.MediaPlayer2.spotify org.mpris.MediaPlayer2.Player";
const LIST = "org.freedesktop.DBus ListNames";
const other = (name: string): string => `${name} org.mpris.MediaPlayer2.Player`;

// 1. Another player.

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
    assert.deepEqual([obs.app, obs.trackId, obs.playing, obs.title, obs.seenAt], [OTHER_PLAYER, null, true, "Spike Song A", 500]);
    // The very recording the class holds, by title, artist, length and id: still not followed.
    const song = { index: 0, title: "Spike Song A", artist: "Spike Artist", lengthMs: 180_000, startMs: 0, endMs: 171_000, trackIds: ["SPIKEEXAMPLE0001"] };
    const plan: LinkPlan = { songs: [song], plannedCrossfadeMs: 9000, manualOnly: false };
    assert.deepEqual(matchCandidates(plan, obs, { lengthToleranceMs: 2500 }), []);
    const own = parseLinuxOutput(PLAYING, 0, 0);
    assert.deepEqual(matchCandidates(plan, own.kind === "reading" ? own.obs : assert.fail(), { lengthToleranceMs: 2500 }), [0], "Spotify's own reading of it is followed");
  });
}

test("a player whose name merely contains Spotify's is another player too", () => {
  for (const name of ["org.mpris.MediaPlayer2.spotifyd", "org.mpris.MediaPlayer2.spotify.instance7", "org.mpris.MediaPlayer2.Spotify", "org.mpris.MediaPlayer2.spotify_player"]) {
    const b = bus({ spotify: FAILED, players: { [name]: PLAYING } });
    b.linux.setActive(true);
    assert.deepEqual(b.asked, [READ, LIST, other(name)], name);
    assert.equal(b.linux.latest(0)?.app, "another player", name);
    assert.doesNotMatch(b.linux.latest(0)?.app ?? "", /spotify/i);
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
  assert.equal(b.linux.latest(0)?.app, OTHER_PLAYER);
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
  assert.equal(b.linux.latest(0)?.app, OTHER_PLAYER);
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

// 2. A reading whose time cannot be told.

test("a reading is dated inside its own call, and one of another player inside that player's call", () => {
  const b = bus({ spotify: PAUSED, players: { [VLC]: PLAYING } });
  b.clock.t = 1000;
  b.clock.step = 40; // every call takes 40 ms
  b.linux.setActive(true);
  // Spotify 1000..1040, the names 1040..1080, the other player 1080..1120.
  assert.deepEqual([b.linux.latest(0)?.at, b.linux.latest(0)?.seenAt], [1100, 1120]);
  b.state.players = {};
  b.poll();
  assert.deepEqual([b.linux.latest(0)?.app, b.linux.latest(0)?.at, b.linux.latest(0)?.seenAt], ["Spotify", 1140, 1160]);
});

for (const [label, step] of [
  ["runs backwards", -40],
  ["is not a number", Number.NaN],
  ["is infinite", Number.POSITIVE_INFINITY],
] as const) {
  test(`a clock that ${label} across the call: no reading is made of it, and the last one ages (rule 8)`, () => {
    const b = bus({ spotify: PLAYING });
    b.clock.t = 1000;
    b.linux.setActive(true);
    const good = b.linux.latest(1000);
    assert.equal(good?.seenAt, 1000);
    assert.ok(good);

    b.state.spotify = PLAYING.replace("12500000", "99000000");
    b.state.players = { [VLC]: PLAYING };
    b.clock.t = 1250;
    b.clock.step = step;
    b.poll();
    b.clock.t = 1300;
    b.clock.step = 0;
    assert.equal(b.linux.latest(1300), good, "neither Spotify's nor the other player's answer became a reading");
    assert.equal(isCurrent(good, 3500, 2500), true);
    assert.equal(isCurrent(good, 3501, 2500), false, "it goes stale by its own time");
    b.poll();
    assert.equal(b.linux.latest(1300)?.positionMs, 99_000, "and a call with a usable time is a reading again");
  });

  test(`a clock that ${label} across the very first call: no reading at all, and no command`, () => {
    const b = bus({ spotify: PLAYING });
    b.clock.step = step;
    b.linux.setActive(true);
    assert.equal(b.linux.latest(0), null);
    b.linux.send("play");
    assert.ok(!b.runs.includes(LINUX_CALLS.play));
  });
}

test("asOtherPlayer keeps the reading's own times and drops what could be matched by id", () => {
  const own = parseLinuxOutput(PLAYING, 10, 20);
  assert.ok(own.kind === "reading");
  assert.deepEqual(asOtherPlayer(own.obs), { ...own.obs, app: "another player", trackId: null });
});

// 3. Commands.

for (const [label, spotify, players] of [
  ["not running", FAILED, {}],
  ["with nothing loaded", STOPPED, {}],
  ["answering garbage", "garbage", {}],
  ["not answering yet", null, {}],
  ["not running while another player plays", FAILED, { [VLC]: PLAYING }],
] as const) {
  test(`no command is sent before Spotify's first good reading: Spotify ${label}`, () => {
    const b = bus({ spotify, players });
    b.linux.setActive(true);
    const before = b.runs.length;
    for (const action of ["play", "pause", "next"] as const) b.linux.send(action);
    assert.equal(b.runs.length, before);
    if (spotify === null) return;
    // Once Spotify has answered well (playing or paused), commands go, and nothing held back is sent late.
    b.state.spotify = PAUSED;
    b.poll();
    assert.equal(b.runs.filter((r) => r === LINUX_CALLS.play || r === LINUX_CALLS.pause || r === LINUX_CALLS.next).length, 0);
    b.linux.send("play");
    assert.equal(b.runs.at(-1), LINUX_CALLS.play);
  });
}

test("the gate closes again when following stops: following anew waits for a new first reading", () => {
  const b = bus({ spotify: PLAYING });
  b.linux.setActive(true);
  b.linux.send("pause");
  assert.equal(b.runs.at(-1), LINUX_CALLS.pause);
  b.linux.setActive(false);
  b.state.spotify = FAILED;
  b.linux.setActive(true);
  const before = b.runs.length;
  b.linux.send("play");
  assert.equal(b.runs.length, before);
});

test("at most one command in flight and one waiting, the newest replacing the one that waits", () => {
  const pending: (() => void)[] = [];
  const sent: string[] = [];
  const exec: ExecFileFn = (_file, args, _options, done) => {
    if (args === LINUX_CALLS.read) return done(null, PLAYING);
    sent.push(args.at(-1) ?? "");
    pending.push(() => done(null, ""));
  };
  const linux = createLinuxMusic({ exec, now: () => 0, every: () => () => undefined });
  linux.setActive(true);
  for (const action of ["pause", "next", "play", "next", "pause", "play"] as const) linux.send(action);
  assert.deepEqual(sent, ["Pause"], "one in flight");
  pending[0]();
  assert.deepEqual(sent, ["Pause", "Play"], "the newest of the five that waited, and only it");
  pending[1]();
  assert.deepEqual(sent, ["Pause", "Play"]);
  assert.equal(pending.length, 2);
});
