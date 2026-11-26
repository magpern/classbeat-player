// The macOS reader inside the shell: chosen by platform, on only while the instructor follows,
// named music commands only, and guards on the source (one place starts a process, never a shell).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JUMP_MS } from "../../src/core/clock/clock.ts";
import { parseClockCommand, parseMusicCommand } from "../../src/core/commands.ts";
import { manualReader } from "../../src/core/link/index.ts";
import type { MusicReader, MusicTransport, Observation, TransportAction } from "../../src/core/link/index.ts";
import { createController } from "../../src/main/controller.ts";
import { selectMusic } from "../../src/main/select-music.ts";
import { converterExamples } from "./fixtures.ts";
import { EXEC_READERS, EXPOSED, holders, MAC, OPENS_PAGE, OPENS_RELEASE, raw, ROOM_EXPOSED, sources, WINDOWS_SPAWN } from "./macos-checks.ts";
import { slashCode } from "./rule-sources.ts";

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

// The checks are in macos-checks.ts, each in two views (issue #861; macos-shell-mutations.test.ts
// shows each catches what a "//" or "/*" in a string hides). The pins below read `slashCode` alone.
const src = (path: string): string => slashCode(raw(path));
const holds = (check: keyof typeof MAC, path: string): boolean => MAC[check](path, raw(path));

test("only the macOS and Linux readers and the Windows helper start a process, the readers with execFile, and never a shell", () => {
  assert.deepEqual(holders(MAC.processes), [...EXEC_READERS, WINDOWS_SPAWN]);
  for (const path of EXEC_READERS) {
    const reader = src(path);
    assert.match(reader, /import \{ execFile \} from "node:child_process";/, path);
    assert.ok(!holds("execFileOnce", path), `${path}: one call site`);
    assert.match(reader, /shell: false/, path);
    assert.ok(!holds("shellOnlyFalse", path), `${path}: never another value`);
  }
  for (const s of sources) {
    assert.ok(!MAC.shells(s.path, s.text), s.path);
    if (s.path !== OPENS_PAGE && s.path !== OPENS_RELEASE) assert.ok(!MAC.opens(s.path, s.text), s.path);
    if (s.path !== WINDOWS_SPAWN) assert.ok(!MAC.spawns(s.path, s.text), s.path);
  }
  assert.ok(!holds("spawnOnce", WINDOWS_SPAWN), "one call site");
  assert.match(src(WINDOWS_SPAWN), /shell: false/);
});

test("the browser is opened in one place, only with the pairing page, which the server's answer must put on its own origin", () => {
  const setup = src(OPENS_PAGE);
  assert.ok(!holds("openOnce", OPENS_PAGE), "one call site");
  assert.match(setup, /openPage: \(url\) => void shell\.openExternal\(url\)/);
  // The pairing page: the one in the start answer, and "Open the page again" opens that same page (the waiting state's), nothing else.
  assert.ok(!holds("pairingPages", "main/pairing/service.ts"));
  assert.match(src("core/pairing/machine.ts"), /kind: "waiting",[\s\S]*?page: answer\.page,/);
  // The open_page effect's page is the start answer's, and that is checked by pairingPageOn.
  assert.ok(!holds("openPageEffects", "core/pairing/machine.ts"));
  assert.match(src("core/pairing/protocol.ts"), /const page = pairingPageOn\(origin, field\(a\.body, "verification_uri"\)\);/);
});

test("the release page is opened in one place, only with the address built from the fixed prefix and a checked newer version", () => {
  const setup = src(OPENS_RELEASE);
  assert.ok(!holds("openOnce", OPENS_RELEASE), "one call site");
  assert.match(setup, /openPage: \(address\) => void shell\.openExternal\(address\)\.catch\(\(\) => undefined\)/);
  // The service hands openPage only what releasePageAddress builds from the shown status, never anything from the page.
  const service = src("main/update/service.ts");
  assert.ok(!holds("releasePages", "main/update/service.ts"));
  // The whole openReleasePage body is pinned, so the one call cannot move to a place where another
  // value is named `address` (the feed's, #810); and `address` is declared there and nowhere else.
  assert.match(service, /\n {4}openReleasePage\(\) \{\n {6}const address = releasePageAddress\(visible\(now\(\)\)\);\n {6}if \(address === null\) return false;\n {6}deps\.openPage\(address\);\n {6}return true;\n {4}\},\n/);
  assert.ok(!holds("addressCount", "main/update/service.ts"), "address only in openReleasePage");
  assert.match(service, /^import \{ couldNotCheck, releasePageAddress, statusAfter \} from "\.\.\/\.\.\/core\/update\/status\.ts";$/m);
  assert.ok(!holds("releaseAddressCount", "main/update/service.ts"), "imported from status.ts and called once, never defined here");
  assert.match(src("core/update/status.ts"), /export const RELEASE_PAGE_PREFIX = "https:\/\/github\.com\/magpern\/classbeat-player\/releases\/tag\/player-v";/);
  assert.match(src("core/update/status.ts"), /return RELEASE_PAGE_PREFIX \+ latest\.text;/);
  // The handler passes no argument on: Open release page takes none.
  assert.match(src("main/update/update-handlers.ts"), /if \(onList\(e\) && raw === undefined\) updates\.openReleasePage\(\);/);
});

test("the scripts are constants: no template text, no joining with data, and one place names osascript", () => {
  assert.ok(!holds("scriptJoins", "core/link/macos-scripts.ts"));
  assert.deepEqual(holders(MAC.namesOsascript), ["core/link/macos-scripts.ts"]);
  assert.deepEqual(holders(MAC.tells), ["core/link/macos-scripts.ts"]);
});

test("the reader is built in the main process only, by platform", () => {
  assert.deepEqual(holders(MAC.buildsMac), ["main/macos-reader.ts", "main/select-music.ts"]);
  assert.deepEqual(holders(MAC.importsMac), ["main/main.ts", "main/select-music.ts"]);
  assert.match(src("main/main.ts"), /selectMusic\(process\.platform\)/);
});

test("the preload bridge: the same four functions, those of pairing (#74), of the class list, of Swedebeat sign-in (#691), of the phone remote (#173), of the riders panel (#366) and of updates (#798); only startClass, mixSignIn, dropPhone, dropRider, lockJoining, setAutomaticChecks and setPrereleases take arguments", () => {
  const preload = src("preload/preload.ts");
  assert.deepEqual([...preload.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]), EXPOSED);
  assert.ok(!holds("exposed", "preload/preload.ts"));
  // The class list's only argument is a class's id and hash (startClass); the shell parses it (core/list/commands.ts).
  assert.match(preload, /^ {2}startClass: \(id: unknown, hash: unknown\): Promise<unknown> => ipcRenderer\.invoke\(CH_LIST_START, \{ id, hash \}\),$/m);
  // Swedebeat's sign-in takes what was typed, passed on as it is; the shell checks it against the source's fields (core/mix/sign-in-input.ts).
  assert.match(preload, /^ {2}mixSignIn: \(credentials: unknown\): Promise<unknown> => ipcRenderer\.invoke\(CH_MIX_SIGN_IN, credentials\),$/m);
  // The phone remote's only argument is the slot to drop, passed on as it is; the shell takes only 1 or 2 (main/live/live-handlers.ts).
  assert.match(preload, /^ {2}dropPhone: \(slot: unknown\): Promise<unknown> => ipcRenderer\.invoke\(CH_LIVE_DROP, slot\),$/m);
  // The riders panel's: the rider's id and the lock's value, passed on as they are; the shell takes only a rider id and a boolean.
  assert.match(preload, /^ {2}dropRider: \(rider: unknown\): Promise<unknown> => ipcRenderer\.invoke\(CH_LIVE_DROP_RIDER, rider\),$/m);
  assert.match(preload, /^ {2}lockJoining: \(locked: unknown\): Promise<unknown> => ipcRenderer\.invoke\(CH_LIVE_LOCK, locked\),$/m);
  // The update switches' one boolean each, passed on as it is; the shell takes only true or false (main/update/update-handlers.ts).
  assert.match(preload, /^ {2}setAutomaticChecks: \(on: unknown\): Promise<unknown> => ipcRenderer\.invoke\(CH_UPDATE_SET_AUTO, on\),$/m);
  assert.match(preload, /^ {2}setPrereleases: \(on: unknown\): Promise<unknown> => ipcRenderer\.invoke\(CH_UPDATE_SET_PRERELEASES, on\),$/m);
  for (const [name, channel] of [["startPairing", "CH_PAIRING_START"], ["pairingState", "CH_PAIRING_STATE"], ["reopenPairingPage", "CH_PAIRING_REOPEN"], ["unpair", "CH_UNPAIR"], ["listView", "CH_LIST_VIEW"], ["openClassFile", "CH_LIST_OPEN_FILE"], ["dismissFileError", "CH_LIST_DISMISS"], ["backToClass", "CH_LIST_BACK"], ["mixSignOut", "CH_MIX_SIGN_OUT"], ["liveView", "CH_LIVE_VIEW"], ["startLive", "CH_LIVE_START"], ["endLive", "CH_LIVE_END"], ["makeControlCode", "CH_LIVE_CODE"], ["riders", "CH_LIVE_RIDERS"], ["newJoinCode", "CH_LIVE_NEW_CODE"], ["updateStatus", "CH_UPDATE_STATUS"], ["checkForUpdate", "CH_UPDATE_CHECK"], ["openReleasePage", "CH_UPDATE_OPEN_RELEASE"]]) {
    assert.match(preload, new RegExp(`^ {2}${name}: \\(\\): Promise<unknown> => ipcRenderer\\.invoke\\(${channel}\\),$`, "m"), name);
  }
  assert.ok(!holds("channels", "core/channels.ts"));
  // The room channels are the room preload's alone (room-ipc.test.ts); the presenter's preload above exposes none.
});

test("the room preload bridge: exactly its functions; none takes an argument from the page but the mix report, rebuilt from four values; every other one sends fixed text", () => {
  const preload = src("preload/room-preload.ts");
  assert.deepEqual([...preload.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]), ROOM_EXPOSED);
  assert.ok(!holds("roomExposed", "preload/room-preload.ts"));
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
  // The mix cue's push takes only a callback; the report is the one function with arguments, and
  // it sends a new object of a number, a number, two flags and a finite number or null (#693),
  // never what the page passed.
  assert.match(preload, /^ {2}onMix: \(cb: \(cue: unknown\) => void\): void => \{\n {4}if \(typeof cb !== "function"\) return;\n {4}ipcRenderer\.on\(CH_ROOM_MIX, \(_e, cue: unknown\) => cb\(cue\)\);\n {2}\},$/m);
  assert.match(
    preload,
    /^ {2}mixReport: \(seq: unknown, positionMs: unknown, playing: unknown, failed: unknown, durationMs: unknown\): Promise<unknown> =>\n {4}ipcRenderer\.invoke\(CH_ROOM_MIX_REPORT, \{ seq: Number\(seq\), positionMs: Number\(positionMs\), playing: playing === true, failed: failed === true, durationMs: typeof durationMs === "number" && Number\.isFinite\(durationMs\) \? durationMs : null \}\),$/m,
  );
  assert.ok(!holds("roomArguments", "preload/room-preload.ts"), "only the report takes values from the page");
  // Every ipcRenderer call is one of the lines above.
  assert.ok(!holds("roomIpcCalls", "preload/room-preload.ts"));
});

test("no Spotify token, sign-in or developer interface, and no network, in the reader", () => {
  // The modules every reader shares (issue #51) are held to the same.
  const shared = ["main/polled-reader.ts", "core/link/reader-lifecycle.ts", "core/link/call-slot.ts", "core/link/between-songs.ts"];
  for (const path of ["main/macos-reader.ts", "main/select-music.ts", "core/link/macos-scripts.ts", "core/link/macos-parse.ts", "core/link/transport.ts", ...shared]) {
    assert.ok(!holds("readerSecrets", path), path);
  }
});
