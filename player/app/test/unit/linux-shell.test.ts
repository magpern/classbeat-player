// The Linux reader inside the shell: chosen on Linux only, on only while the instructor follows,
// named music commands only, and guards on the source (fixed calls, one bus name, never a shell).
// Nothing here starts a process or talks to a D-Bus: the reader's execFile is a fake.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import type { MusicReader, MusicTransport, TransportAction } from "../../src/core/link/index.ts";
import { BUSCTL, LINUX_CALLS } from "../../src/core/link/linux-calls.ts";
import { createController } from "../../src/main/controller.ts";
import { registerHandlers } from "../../src/main/ipc-handlers.ts";
import type { PairingService } from "../../src/main/pairing/service.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import { createLinuxMusic } from "../../src/main/linux-reader.ts";
import type { ExecFileFn } from "../../src/main/linux-reader.ts";
import { selectMusic } from "../../src/main/select-music.ts";
import { converterExamples, REPO } from "./fixtures.ts";

const SRC = join(REPO, "player", "app", "src");
const FIXTURES = join(REPO, "player", "app", "test", "fixtures", "linux");
const text = readFileSync(converterExamples()[0], "utf8");
const first = JSON.parse(text).songs[0] as { title: string; artist: string; length_ms: number };

function fake(kind: "macos" | "linux"): MusicReader & MusicTransport {
  return { kind, latest: () => null, setActive: () => undefined, send: () => undefined };
}

test("the reader is chosen by platform: the Linux one on Linux only, the macOS one on macOS only", () => {
  const mac = fake("macos");
  const linux = fake("linux");
  const never = (): never => assert.fail("another system's reader was constructed");
  const onLinux = selectMusic("linux", never, never, () => linux);
  assert.equal(onLinux.reader, linux);
  assert.equal(onLinux.transport, linux);
  assert.equal(selectMusic("darwin", () => mac, never, never).reader, mac);
  assert.equal(selectMusic("win32", never, () => mac, never).reader, mac);
});

test("the real selection on Linux is the Linux reader, and constructing it runs nothing", { skip: process.platform !== "linux" }, () => {
  const chosen = selectMusic("linux");
  assert.equal(chosen.reader.kind, "linux");
  assert.equal(chosen.transport, chosen.reader);
  assert.equal(chosen.reader.latest(0), null);
});

/** The real reader and the real controller; only the process start, the clock and the timer are fakes. */
function shell() {
  const runs: { file: string; args: readonly string[]; done: (e: Error | null, out: string) => void }[] = [];
  const clock = { t: 0 };
  let ticks: (() => void)[] = [];
  // The bus has no other player: its names are answered at once and not counted in `runs`.
  const exec: ExecFileFn = (file, args, _options, done) => (args === LINUX_CALLS.names ? done(null, '{"type":"as","data":[[]]}') : void runs.push({ file, args, done }));
  const every = (fn: () => void): (() => void) => {
    ticks.push(fn);
    return () => {
      ticks = ticks.filter((f) => f !== fn);
    };
  };
  const linux = createLinuxMusic({ exec, now: () => clock.t, every });
  const c = createController(() => clock.t, linux, linux);
  return { c, runs, clock, tick: () => ticks.forEach((f) => f()), timers: () => ticks.length };
}

const playing = (title: string, artist: string, lengthMs: number, positionMs: number): string =>
  JSON.stringify({
    type: "a{sv}",
    data: [
      {
        PlaybackStatus: { type: "s", data: "Playing" },
        Position: { type: "x", data: positionMs * 1000 },
        Metadata: { type: "a{sv}", data: { "xesam:title": { type: "s", data: title }, "xesam:artist": { type: "as", data: [artist] }, "mpris:length": { type: "t", data: lengthMs * 1000 } } },
      },
    ],
  });

test("no helper runs until the instructor picks Follow, and none after the manual clock is chosen", () => {
  const s = shell();
  s.c.snapshot();
  const opened = s.c.open("a.json", text);
  assert.equal(opened.link?.available, true);
  assert.equal(opened.link?.mode, "manual", "a class opens on the manual clock");
  s.c.command({ type: "start" });
  s.c.music("play");
  s.c.snapshot();
  s.tick();
  assert.equal(s.runs.length, 0, "the manual clock asks the system nothing");
  assert.equal(s.timers(), 0);

  assert.equal(s.c.command({ type: "follow" }).link?.mode, "following");
  assert.equal(s.runs.length, 1);
  assert.equal(s.runs[0].file, BUSCTL);
  assert.equal(s.runs[0].args, LINUX_CALLS.read);
  assert.equal(s.timers(), 1);

  s.clock.t = 100;
  s.runs[0].done(null, playing(first.title, first.artist, first.length_ms, 30_000));
  assert.equal(s.c.snapshot().link?.state, "Locked", "the class follows what Spotify reports");

  assert.equal(s.c.command({ type: "manual" }).link?.mode, "manual");
  assert.equal(s.timers(), 0);
  s.tick();
  s.c.music("next");
  assert.equal(s.runs.length, 1);

  s.c.command({ type: "follow" });
  assert.equal(s.runs.length, 2);
  s.c.stop();
  assert.equal(s.timers(), 0, "and nothing runs after the shell stops");
});

test("when the helper goes quiet the class coasts within 3 s on the last reading (rule 8)", () => {
  const s = shell();
  s.c.open("a.json", text);
  s.c.command({ type: "follow" });
  s.clock.t = 100;
  s.runs[0].done(null, playing(first.title, first.artist, first.length_ms, 30_000));
  assert.equal(s.c.snapshot().link?.state, "Locked");
  for (const t of [350, 600, 2000, 2700]) {
    s.clock.t = t;
    s.tick();
    s.runs.at(-1)?.done(Object.assign(new Error("Call failed"), { code: 1 }), "");
    assert.equal(s.c.snapshot().link?.state, t < 2700 ? "Locked" : "Coasting", `at ${t} ms`);
  }
  assert.ok(s.runs.every((r) => r.args === LINUX_CALLS.read), "and it only ever asks again");
  s.c.stop();
});

test("music commands cross the bridge as names only, and reach busctl only while following", () => {
  const s = shell();
  const handlers = new Map<string, (event: never, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (channel, listener) => void handlers.set(channel, listener as (event: never, raw: unknown) => unknown) };
  const trusted = { presenterId: 1, presenterUrl: "file:///app/presenter.html", listUrl: "file:///app/classlist.html" };
  registerHandlers(bus, s.c, () => trusted, {} as PairingService);
  const event = { sender: { id: 1 }, senderFrame: { parent: null, url: trusted.presenterUrl } } as never;
  const send = (raw: unknown): unknown => handlers.get("player:command")?.(event, raw);
  const sent = (): readonly (readonly string[])[] => s.runs.map((r) => r.args).filter((a) => a !== LINUX_CALLS.read);

  s.c.open("a.json", text);
  assert.notEqual(send({ type: "music", action: "play" }), null);
  assert.deepEqual(sent(), [], "not following: nothing is sent");

  send({ type: "follow" });
  s.runs[0].done(null, playing(first.title, first.artist, first.length_ms, 1000));
  const actions: readonly TransportAction[] = ["play", "pause", "next"];
  for (const action of actions) {
    assert.notEqual(send({ type: "music", action }), null);
    assert.equal(sent().at(-1), LINUX_CALLS[action]);
    s.runs.at(-1)?.done(null, "");
  }
  const before = s.runs.length;
  for (const bad of [
    { type: "music", action: "Raise" },
    { type: "music", action: "PlayPause" },
    { type: "music", action: "read" },
    { type: "music", action: "names" },
    { type: "music", action: "play", args: ["--system"] },
    { type: "music", action: ["--auto-start=yes"] },
    { type: "music", action: "org.mpris.MediaPlayer2.Player Quit" },
  ]) {
    assert.equal(send(bad), null, JSON.stringify(bad));
  }
  assert.equal(s.runs.length, before, "anything else is refused before it reaches the reader");
  assert.ok(s.runs.every((r) => r.file === BUSCTL && [LINUX_CALLS.read, LINUX_CALLS.play, LINUX_CALLS.pause, LINUX_CALLS.next].includes(r.args as never)));
  s.c.stop();
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const sources = files(SRC).map((p) => ({ path: relative(SRC, p).split(sep).join("/"), text: readFileSync(p, "utf8") }));
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = (path: string): string => code(sources.find((s) => s.path === path)?.text ?? assert.fail(`missing ${path}`));

test("the calls are constants: no template text, no joining with data, and one place names busctl and the bus", () => {
  const calls = src("core/link/linux-calls.ts");
  assert.doesNotMatch(calls, /`|\$\{|\+|\.concat\(|\.replace\(|\.join\(|\.push\(|\.map\(/);
  // The only spreading is of the frozen constant lists. The one value that is not a constant is
  // another player's bus name, checked where it is used (test/unit/linux-others.test.ts).
  assert.deepEqual([...calls.matchAll(/\.\.\.(\w+)/g)].map((m) => m[1]), ["CALL", "BASE", "GET_ALL", "BASE", "BASE", "BASE", "CALL", "CALL", "GET_ALL"]);
  assert.match(calls, /return isOtherPlayer\(name\) \? Object\.freeze\(\[\.\.\.CALL, name, PATH, \.\.\.GET_ALL\]\) : null;/);
  const namers = sources.filter((s) => /busctl"|org\.mpris|org\.freedesktop|--user|--auto-start|dbus/i.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(namers, ["core/link/linux-calls.ts"]);
  assert.equal(calls.match(/org\.mpris\.MediaPlayer2\.\w+/g)?.join(), "org.mpris.MediaPlayer2.spotify,org.mpris.MediaPlayer2.Player");
});

test("the Linux reader is built in the main process only, by platform", () => {
  const builders = sources.filter((s) => /\bcreateLinuxMusic\b/.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(builders.sort(), ["main/linux-reader.ts", "main/select-music.ts"]);
  const importers = sources.filter((s) => /linux-reader|linux-calls|linux-parse/.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(importers.sort(), ["core/link/linux-parse.ts", "main/linux-reader.ts", "main/select-music.ts"]);
  assert.match(src("main/select-music.ts"), /platform === "linux" \? makeLinux : null/);
});

test("no Spotify token, sign-in or developer interface, no network and no file, in the Linux reader", () => {
  for (const path of ["main/linux-reader.ts", "core/link/linux-calls.ts", "core/link/linux-parse.ts"]) {
    assert.doesNotMatch(src(path), /token|oauth|client.?id|bearer|authoriz|https?:|fetch\(|node:net|node:http|node:dns|node:fs|process\.env|\benv\b/i, path);
  }
});

test("the recorded outputs hold no real account's data", () => {
  for (const name of readdirSync(FIXTURES)) {
    const body = readFileSync(join(FIXTURES, name), "utf8");
    assert.match(body, /^\{"type":"a\{sv\}"/, name);
    assert.doesNotMatch(body, /token|bearer|user:|@/i, name);
  }
});
