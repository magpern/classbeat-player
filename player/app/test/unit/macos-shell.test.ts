// The macOS reader inside the shell: chosen by platform, on only while the instructor follows,
// named music commands only, and guards on the source (one place starts a process, never a shell).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { parseClockCommand, parseMusicCommand } from "../../src/core/commands.ts";
import { manualReader } from "../../src/core/link/index.ts";
import type { MusicReader, MusicTransport, Observation, TransportAction } from "../../src/core/link/index.ts";
import { createController } from "../../src/main/controller.ts";
import { selectMusic } from "../../src/main/select-music.ts";
import { converterExamples, REPO } from "./fixtures.ts";

const SRC = join(REPO, "player", "app", "src");
const text = readFileSync(converterExamples()[0], "utf8");
const first = JSON.parse(text).songs[0] as { title: string; artist: string; length_ms: number };

function fakeMac(): MusicReader & MusicTransport & { active: boolean[]; sent: TransportAction[]; obs: Observation | null } {
  const self = {
    kind: "macos" as const,
    active: [] as boolean[],
    sent: [] as TransportAction[],
    obs: null as Observation | null,
    latest: (): Observation | null => self.obs,
    setActive: (on: boolean): void => void self.active.push(on),
    send: (action: TransportAction): void => void self.sent.push(action),
  };
  return self;
}

test("the reader is chosen by platform: the macOS one on macOS only", () => {
  const mac = fakeMac();
  const chosen = selectMusic("darwin", () => mac);
  assert.equal(chosen.reader, mac);
  assert.equal(chosen.transport, mac);
  assert.equal(chosen.reader.kind, "macos");
});

for (const platform of ["linux", "freebsd", "", "Darwin", "darwin "]) {
  test(`on "${platform}" the macOS reader is never constructed and the clock is manual`, () => {
    const chosen = selectMusic(platform, () => assert.fail("constructed"));
    assert.equal(chosen.reader, manualReader);
    assert.equal(chosen.transport, null);
  });
}

test("the real selection on this machine: nothing is constructed unless it has a reader of its own", { skip: process.platform === "darwin" || process.platform === "win32" }, () => {
  const chosen = selectMusic(process.platform);
  assert.equal(chosen.reader.kind, "manual");
  assert.equal(chosen.transport, null);
});

test("with the manual reader the shell starts on the manual clock and music commands do nothing", () => {
  const c = createController(() => 0);
  const snap = c.open("a.json", text);
  assert.equal(snap.link?.available, false);
  assert.equal(snap.link?.state, "Manual");
  assert.equal(c.command({ type: "start" }).view?.status, "running");
  assert.equal(c.music("play").view?.status, "running");
});

test("the reader runs only when the instructor picks Follow, and stops on the manual clock", () => {
  const mac = fakeMac();
  let t = 0;
  const c = createController(() => t, mac, mac);
  const on = (): boolean => mac.active.at(-1) ?? false;

  assert.equal(on(), false, "nothing before a class is open");
  const opened = c.open("a.json", text);
  assert.equal(opened.link?.available, true);
  assert.equal(opened.link?.mode, "manual", "a class opens on the manual clock");
  assert.equal(on(), false);
  c.command({ type: "start" });
  c.snapshot();
  assert.equal(on(), false, "the manual clock asks the system nothing");

  assert.equal(c.command({ type: "follow" }).link?.mode, "following");
  assert.equal(on(), true);
  t = 1000;
  mac.obs = { title: first.title, artist: first.artist, lengthMs: first.length_ms, positionMs: 30_000, playing: true, at: 1000, seenAt: 1000 };
  assert.equal(c.snapshot().link?.state, "Locked");

  assert.equal(c.command({ type: "manual" }).link?.mode, "manual");
  assert.equal(on(), false);
  c.command({ type: "follow" });
  assert.equal(on(), true);
  c.open("b.json", text);
  assert.equal(on(), false, "a newly opened class is on the manual clock again");
  c.command({ type: "follow" });
  c.stop();
  assert.equal(on(), false, "and nothing runs after the shell stops");
});

test("music commands reach the music app only while following", () => {
  const mac = fakeMac();
  const c = createController(() => 0, mac, mac);
  c.music("play");
  c.open("a.json", text);
  c.music("play");
  assert.deepEqual(mac.sent, []);
  c.command({ type: "follow" });
  c.music("play");
  c.music("pause");
  c.music("next");
  assert.deepEqual(mac.sent, ["play", "pause", "next"]);
  c.command({ type: "manual" });
  c.music("next");
  assert.deepEqual(mac.sent, ["play", "pause", "next"]);
});

test("music commands are three fixed names; anything else is refused", () => {
  for (const action of ["play", "pause", "next"]) assert.deepEqual(parseMusicCommand({ type: "music", action }), { type: "music", action });
  const proto = Object.create({ type: "music", action: "play" });
  for (const bad of [
    null,
    "play",
    proto,
    ["music", "play"],
    { type: "music" },
    { type: "music", action: "previous" },
    { type: "music", action: "Play" },
    { type: "music", action: "play " },
    { type: "music", action: ["play"] },
    { type: "music", action: { toString: () => "play" } },
    { type: "music", action: "toString" },
    { type: "music", action: 'play" & (do shell script "x") & "' },
    { type: "music", action: "play", script: "x" },
    { type: "music", action: "play", args: ["-e", "x"] },
    { type: "play" },
    { type: "music-play" },
  ]) {
    assert.equal(parseMusicCommand(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseClockCommand({ type: "music", action: "play" }), null, "and it is not a clock command");
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

// The Windows helper (#42) is the one other process, started in main/readers/windows-spawn.ts;
// test/unit/windows-script.test.ts pins how.
const WINDOWS_SPAWN = "main/readers/windows-spawn.ts";

test("only the macOS reader and the Windows helper start a process, the first with execFile, and never a shell", () => {
  const users = sources.filter((s) => /child_process/.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(users.sort(), ["main/macos-reader.ts", WINDOWS_SPAWN]);
  const reader = src("main/macos-reader.ts");
  assert.match(reader, /import \{ execFile \} from "node:child_process";/);
  assert.equal(reader.match(/\bexecFile\(/g)?.length, 1, "one call site");
  assert.match(reader, /shell: false/);
  for (const s of sources) {
    assert.doesNotMatch(code(s.text), /\b(exec|execSync|execFileSync|spawnSync|fork)\(|shell:\s*true|\bshell\.openExternal\b|\bopenPath\b/, s.path);
    if (s.path !== WINDOWS_SPAWN) assert.doesNotMatch(code(s.text), /\bspawn\(/, s.path);
  }
  assert.equal(src(WINDOWS_SPAWN).match(/\bspawn\(/g)?.length, 1, "one call site");
  assert.match(src(WINDOWS_SPAWN), /shell: false/);
});

test("the scripts are constants: no template text, no joining with data, and one place names osascript", () => {
  const scripts = src("core/link/macos-scripts.ts");
  assert.doesNotMatch(scripts, /`|\$\{|\+|\.concat\(|\.replace\(|\.join\(/);
  const namers = sources.filter((s) => /osascript"/.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(namers, ["core/link/macos-scripts.ts"]);
  const tellers = sources.filter((s) => /tell application|-e"/.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(tellers, ["core/link/macos-scripts.ts"]);
});

test("the reader is built in the main process only, by platform", () => {
  const builders = sources.filter((s) => /\bcreateMacMusic\b/.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(builders.sort(), ["main/macos-reader.ts", "main/select-music.ts"]);
  const importers = sources.filter((s) => /macos-reader|select-music/.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(importers.sort(), ["main/main.ts", "main/select-music.ts"]);
  assert.match(src("main/main.ts"), /selectMusic\(process\.platform\)/);
});

test("the preload bridge is unchanged: the same four functions and no new channel", () => {
  const preload = src("preload/preload.ts");
  const exposed = [...preload.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(exposed, ["getState", "command", "openDropped", "onUpdate"]);
  assert.deepEqual([...src("core/channels.ts").matchAll(/"([^"]+)"/g)].map((m) => m[1]), ["player:state", "player:command", "player:open-dropped", "player:update"]);
});

test("no Spotify token, sign-in or developer interface, and no network, in the reader", () => {
  for (const path of ["main/macos-reader.ts", "main/select-music.ts", "core/link/macos-scripts.ts", "core/link/macos-parse.ts", "core/link/transport.ts"]) {
    assert.doesNotMatch(src(path), /token|oauth|client.?id|bearer|authoriz|https?:|fetch\(|node:net|node:http|node:dns|node:fs|process\.env/i, path);
  }
});
