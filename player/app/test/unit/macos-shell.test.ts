// The macOS reader inside the shell: chosen by platform, on only while the instructor follows,
// named music commands only, and guards on the source (one place starts a process, never a shell).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { JUMP_MS } from "../../src/core/clock/clock.ts";
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

const never = (): never => assert.fail("constructed");

for (const platform of ["freebsd", "", "Darwin", "darwin ", "Linux", "linux ", "Win32"]) {
  test(`on "${platform}" no reader is ever constructed and the clock is manual`, () => {
    const chosen = selectMusic(platform, never, never, never);
    assert.equal(chosen.reader, manualReader);
    assert.equal(chosen.transport, null);
  });
}

// Windows and Linux have their own (test/unit/windows-shell.test.ts, test/unit/linux-shell.test.ts).
test("the real selection on this machine: nothing is constructed unless it has a reader of its own", { skip: ["darwin", "win32", "linux"].includes(process.platform) }, () => {
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

// The Windows helper (#42) is the one process not run with execFile, started in
// main/readers/windows-spawn.ts; test/unit/windows-script.test.ts pins how.
const WINDOWS_SPAWN = "main/readers/windows-spawn.ts";
const EXEC_READERS = ["main/linux-reader.ts", "main/macos-reader.ts"];
// The one place that opens anything in the system: the pairing page in the browser (#74).
const OPENS_PAGE = "main/pairing/setup.ts";

test("only the macOS and Linux readers and the Windows helper start a process, the readers with execFile, and never a shell", () => {
  const users = sources.filter((s) => /child_process/.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(users.sort(), [...EXEC_READERS, WINDOWS_SPAWN]);
  for (const path of EXEC_READERS) {
    const reader = src(path);
    assert.match(reader, /import \{ execFile \} from "node:child_process";/, path);
    assert.equal(reader.match(/\bexecFile\(/g)?.length, 1, `${path}: one call site`);
    assert.match(reader, /shell: false/, path);
    assert.equal(reader.match(/\bshell:/g)?.length, reader.match(/\bshell: false\b/g)?.length, `${path}: never another value`);
  }
  for (const s of sources) {
    assert.doesNotMatch(code(s.text), /\b(exec|execSync|execFileSync|spawnSync|fork)\(|shell:\s*true|\bopenPath\b/, s.path);
    if (s.path !== OPENS_PAGE) assert.doesNotMatch(code(s.text), /\bopenExternal\b/, s.path);
    if (s.path !== WINDOWS_SPAWN) assert.doesNotMatch(code(s.text), /\bspawn\(/, s.path);
  }
  assert.equal(src(WINDOWS_SPAWN).match(/\bspawn\(/g)?.length, 1, "one call site");
  assert.match(src(WINDOWS_SPAWN), /shell: false/);
});

test("the browser is opened in one place, only with the pairing page, which the server's answer must put on its own origin", () => {
  const setup = src(OPENS_PAGE);
  assert.equal(setup.match(/\bopenExternal\b/g)?.length, 1, "one call site");
  assert.match(setup, /openPage: \(url\) => void shell\.openExternal\(url\)/);
  const service = src("main/pairing/service.ts");
  // The pairing page: the one in the start answer, and "Open the page again" opens that same page (the waiting state's), nothing else.
  assert.deepEqual([...service.matchAll(/\bd\.openPage\(([^)]*)\)/g)].map((m) => m[1]), ["e.page", "state.page"]);
  assert.match(src("core/pairing/machine.ts"), /kind: "waiting",[\s\S]*?page: answer\.page,/);
  // The open_page effect's page is the start answer's, and that is checked by pairingPageOn.
  const machine = src("core/pairing/machine.ts");
  assert.deepEqual([...machine.matchAll(/do: "open_page", page: ([\w.]+)/g)].map((m) => m[1]), ["answer.page"]);
  assert.match(src("core/pairing/protocol.ts"), /const page = pairingPageOn\(origin, field\(a\.body, "verification_uri"\)\);/);
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

test("the preload bridge: the same four functions, those of pairing (#74), of the class list and of the phone remote (#173); only startClass and dropPhone take arguments", () => {
  const preload = src("preload/preload.ts");
  const exposed = [...preload.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(exposed, ["getState", "command", "openDropped", "onUpdate", "startPairing", "pairingState", "reopenPairingPage", "unpair", "listView", "startClass", "openClassFile", "dismissFileError", "backToClass", "liveView", "startLive", "endLive", "makeControlCode", "dropPhone"]);
  // The class list's only argument is a class's id and hash (startClass); the shell parses it (core/list/commands.ts).
  assert.match(preload, /^ {2}startClass: \(id: unknown, hash: unknown\): Promise<unknown> => ipcRenderer\.invoke\(CH_LIST_START, \{ id, hash \}\),$/m);
  // The phone remote's only argument is the slot to drop, passed on as it is; the shell takes only 1 or 2 (main/live/live-handlers.ts).
  assert.match(preload, /^ {2}dropPhone: \(slot: unknown\): Promise<unknown> => ipcRenderer\.invoke\(CH_LIVE_DROP, slot\),$/m);
  for (const [name, channel] of [["startPairing", "CH_PAIRING_START"], ["pairingState", "CH_PAIRING_STATE"], ["reopenPairingPage", "CH_PAIRING_REOPEN"], ["unpair", "CH_UNPAIR"], ["listView", "CH_LIST_VIEW"], ["openClassFile", "CH_LIST_OPEN_FILE"], ["dismissFileError", "CH_LIST_DISMISS"], ["backToClass", "CH_LIST_BACK"], ["liveView", "CH_LIVE_VIEW"], ["startLive", "CH_LIVE_START"], ["endLive", "CH_LIVE_END"], ["makeControlCode", "CH_LIVE_CODE"]]) {
    assert.match(preload, new RegExp(`^ {2}${name}: \\(\\): Promise<unknown> => ipcRenderer\\.invoke\\(${channel}\\),$`, "m"), name);
  }
  assert.deepEqual(
    [...src("core/channels.ts").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    ["player:state", "player:command", "player:open-dropped", "player:update", "player:pairing-start", "player:pairing-state", "player:unpair", "player:pairing-reopen", "list:view", "list:start", "list:open-file", "list:dismiss-error", "list:back", "room:state", "room:update", "room:command", "room:end", "room:remote-state", "room:remote-start", "room:remote-stop", "room:remote-update", "live:view", "live:start", "live:end", "live:code", "live:drop"],
  );
  // The room channels are the room preload's alone (room-ipc.test.ts); the presenter's preload above exposes none.
});

test("the room preload bridge: exactly its functions, and none takes an argument from the page; every one sends fixed text", () => {
  const preload = src("preload/room-preload.ts");
  const exposed = [...preload.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(exposed, ["state", "onUpdate", "start", "pause", "resume", "previous", "next", "forward", "back", "undo", "follow", "endClass", "remoteState", "startRemote", "stopRemote", "onRemote"]);
  const invoke = (name: string, args: string): RegExp => new RegExp(`^ {2}${name}: \\(\\): Promise<unknown> => ipcRenderer\\.invoke\\(${args}\\),$`, "m");
  // The clock commands: one fixed object each, the 5 s steps with the clock's own JUMP_MS.
  assert.equal(JUMP_MS, 5000);
  for (const [name, args] of [
    ["state", "CH_ROOM_STATE"],
    ["start", 'CH_ROOM_COMMAND, \\{ type: "start" \\}'],
    ["pause", 'CH_ROOM_COMMAND, \\{ type: "pause" \\}'],
    ["resume", 'CH_ROOM_COMMAND, \\{ type: "resume" \\}'],
    ["previous", 'CH_ROOM_COMMAND, \\{ type: "previous" \\}'],
    ["next", 'CH_ROOM_COMMAND, \\{ type: "next" \\}'],
    ["forward", 'CH_ROOM_COMMAND, \\{ type: "jump", deltaMs: 5000 \\}'],
    ["back", 'CH_ROOM_COMMAND, \\{ type: "jump", deltaMs: -5000 \\}'],
    ["undo", 'CH_ROOM_COMMAND, \\{ type: "undo" \\}'],
    ["follow", 'CH_ROOM_COMMAND, \\{ type: "follow" \\}'],
    ["endClass", "CH_ROOM_END"],
    ["remoteState", "CH_ROOM_REMOTE_STATE"],
    ["startRemote", "CH_ROOM_REMOTE_START"],
    ["stopRemote", "CH_ROOM_REMOTE_STOP"],
  ]) {
    assert.match(preload, invoke(name, args), name);
  }
  // The two pushes take only a callback, and pass the page only what the shell sent.
  assert.match(preload, /^ {2}onUpdate: \(cb: \(frame: unknown\) => void\): void => \{\n {4}if \(typeof cb !== "function"\) return;\n {4}ipcRenderer\.on\(CH_ROOM_UPDATE, \(_e, frame: unknown\) => cb\(frame\)\);\n {2}\},$/m);
  assert.match(preload, /^ {2}onRemote: \(cb: \(slot: unknown\) => void\): void => \{\n {4}if \(typeof cb !== "function"\) return;\n {4}ipcRenderer\.on\(CH_ROOM_REMOTE_UPDATE, \(_e, slot: unknown\) => cb\(slot\)\);\n {2}\},$/m);
  // Every ipcRenderer call is one of the lines above.
  assert.equal([...preload.matchAll(/ipcRenderer\./g)].length, exposed.length);
});

test("no Spotify token, sign-in or developer interface, and no network, in the reader", () => {
  // The modules every reader shares (issue #51) are held to the same.
  const shared = ["main/polled-reader.ts", "core/link/reader-lifecycle.ts", "core/link/call-slot.ts", "core/link/between-songs.ts"];
  for (const path of ["main/macos-reader.ts", "main/select-music.ts", "core/link/macos-scripts.ts", "core/link/macos-parse.ts", "core/link/transport.ts", ...shared]) {
    assert.doesNotMatch(src(path), /token|oauth|client.?id|bearer|authoriz|https?:|fetch\(|node:net|node:http|node:dns|node:fs|process\.env/i, path);
  }
});
