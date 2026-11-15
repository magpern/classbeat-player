// Start's playlist load at the followers' edge (issue #488), with a fake execFile: nothing here
// starts a process. The id is checked again immediately before any command is built, the command
// is only the fixed prefix plus that id, a closed Spotify is never started, and nothing changes the
// user's Spotify settings.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BUSCTL, linuxOpenUriArgs, LINUX_CALLS } from "../../src/core/link/linux-calls.ts";
import { MAC_LOAD_SCRIPT, MAC_SCRIPTS, macLoadOutcome, OSASCRIPT, osascriptLoadArgs } from "../../src/core/link/macos-scripts.ts";
import type { LoadOutcome } from "../../src/core/link/playlist.ts";
import { createLinuxMusic } from "../../src/main/linux-reader.ts";
import { createMacMusic } from "../../src/main/macos-reader.ts";
import type { ExecFileFn } from "../../src/main/polled-reader.ts";

const ID = "37i9dQZF1DXcBWIGoYBM5M";
const URI = `spotify:playlist:${ID}`;
const GUARD = 'if application "Spotify" is not running then return "notrunning"';
const SCRIPT_ARGS = MAC_LOAD_SCRIPT.flatMap((l) => ["-e", l]);
/** An id with a quote, a space, a colon and a newline, each where a well-formed one has a letter. */
const BAD: readonly string[] = [`${ID.slice(0, 10)}"${ID.slice(11)}`, `${ID.slice(0, 10)} ${ID.slice(11)}`, `${ID.slice(0, 10)}:${ID.slice(11)}`, `${ID.slice(0, 10)}\n${ID.slice(11)}`, `${ID}\n`, `${ID}" & (do shell script "x") & "`, `${ID.slice(0, 21)}'`, ""];

interface Exec {
  readonly file: string;
  readonly args: readonly string[];
  readonly done: (error: Error | null, stdout: string) => void;
}

function rig(system: "macos" | "linux"): { reader: ReturnType<typeof createMacMusic> | ReturnType<typeof createLinuxMusic>; calls: Exec[]; loads: () => Exec[] } {
  const calls: Exec[] = [];
  const exec: ExecFileFn = (file, args, _options, done) => void calls.push({ file, args, done });
  const deps = { exec, now: () => 0, every: () => () => undefined };
  const reader = system === "macos" ? createMacMusic(deps) : createLinuxMusic(deps);
  const isLoad = (c: Exec): boolean => (system === "macos" ? c.args.includes(MAC_LOAD_SCRIPT[0]) : c.args.includes("OpenUri"));
  return { reader, calls, loads: () => calls.filter(isLoad) };
}

test("macOS: the load script is fixed, guarded first, and takes the link only as data", () => {
  assert.deepEqual(MAC_LOAD_SCRIPT, ["on run argv", GUARD, "set playlistUriText to item 1 of argv", 'tell application "Spotify" to play track playlistUriText', 'return "asked"', "end run"]);
  assert.ok(Object.isFrozen(MAC_LOAD_SCRIPT));
  // The guard comes before anything addresses Spotify, so a closed Spotify is never started.
  assert.equal(MAC_LOAD_SCRIPT.indexOf(GUARD), 1);
  assert.ok(MAC_LOAD_SCRIPT.findIndex((l) => /tell application/.test(l)) > MAC_LOAD_SCRIPT.indexOf(GUARD));
  const text = MAC_LOAD_SCRIPT.join("\n");
  // Nothing that starts an app or a shell, and nothing that changes the user's settings (shuffle, repeat, volume).
  assert.doesNotMatch(text, /\b(launch|activate|open|do shell script|volume|shuffl\w*|repeat\w*|set sound|http|token)\b/i);
  assert.doesNotMatch(text.replace(/^on run argv$|^end run$/gm, ""), /\brun\b/, "run only as the script's own handler");
  assert.doesNotMatch(text, /spotify:/, "the link is never written into the script");
  assert.deepEqual(osascriptLoadArgs(ID), [...SCRIPT_ARGS, URI]);
  assert.ok(Object.isFrozen(osascriptLoadArgs(ID)));
  assert.equal(Object.hasOwn(MAC_SCRIPTS, "load"), false, "not a command name: nothing from the screen can name it");
});

test("Linux: the load is OpenUri on Spotify's own name, starting nothing, with the link as its one string", () => {
  assert.deepEqual(linuxOpenUriArgs(ID), ["--user", "--no-pager", "--auto-start=no", "--timeout=500ms", "--json=short", "call", "org.mpris.MediaPlayer2.spotify", "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", "OpenUri", "s", URI]);
  assert.ok(Object.isFrozen(linuxOpenUriArgs(ID)));
  assert.equal(Object.hasOwn(LINUX_CALLS, "openUri"), false);
});

test("an id with a quote, a space, a colon or a newline is refused at the edge: no command is built and nothing runs", () => {
  for (const bad of BAD) {
    assert.equal(osascriptLoadArgs(bad), null, JSON.stringify(bad));
    assert.equal(linuxOpenUriArgs(bad), null, JSON.stringify(bad));
  }
  for (const bad of [null, undefined, 22, [ID], { toString: () => ID }]) {
    assert.equal(osascriptLoadArgs(bad), null, String(bad));
    assert.equal(linuxOpenUriArgs(bad), null, String(bad));
  }
  for (const system of ["macos", "linux"] as const) {
    const r = rig(system);
    r.reader.setActive(true);
    const before = r.calls.length;
    for (const bad of BAD) {
      const got: LoadOutcome[] = [];
      r.reader.loadPlaylist(bad, (o) => got.push(o));
      assert.deepEqual(got, ["failed"], `${system} ${JSON.stringify(bad)}`);
    }
    assert.equal(r.calls.length, before, `${system}: no process was started for any of them`);
  }
});

test("a well-formed id: the follower runs exactly the fixed command, with the link as the only value", () => {
  for (const system of ["macos", "linux"] as const) {
    const r = rig(system);
    r.reader.setActive(true);
    const got: LoadOutcome[] = [];
    r.reader.loadPlaylist(ID, (o) => got.push(o));
    const [load] = r.loads();
    assert.equal(r.loads().length, 1);
    assert.equal(load.file, system === "macos" ? OSASCRIPT : BUSCTL);
    assert.deepEqual(load.args, system === "macos" ? [...SCRIPT_ARGS, URI] : linuxOpenUriArgs(ID));
    assert.equal(load.args.filter((a) => a.includes(ID)).length, 1);
    assert.equal(load.args.at(-1), URI);
    assert.deepEqual(got, [], "it never waits: the answer comes later");
    load.done(null, system === "macos" ? "asked\n" : "");
    assert.deepEqual(got, ["asked"]);
  }
});

test("macOS: a closed Spotify is not launched by the load, and counts as not loaded", () => {
  const r = rig("macos");
  r.reader.setActive(true);
  const got: LoadOutcome[] = [];
  r.reader.loadPlaylist(ID, (o) => got.push(o));
  // The script's guard returns before the `tell` that would start Spotify: its answer is "notrunning".
  r.loads()[0].done(null, "notrunning\n");
  assert.deepEqual(got, ["not-running"]);
  assert.equal(r.loads().length, 1, "no other call is made to start or retry it");
  assert.equal(macLoadOutcome("notrunning\n"), "not-running");
  for (const out of [null, "", "garbage", "asked and more"]) assert.equal(macLoadOutcome(out), "failed", String(out));
  assert.equal(macLoadOutcome("asked\n"), "asked");
});

test("a failed, refused or hung load is failed; and nothing is loaded while not following", () => {
  for (const system of ["macos", "linux"] as const) {
    const r = rig(system);
    const got: LoadOutcome[] = [];
    r.reader.loadPlaylist(ID, (o) => got.push(o));
    assert.deepEqual(got, ["unsupported"], `${system}: not following`);
    assert.equal(r.calls.length, 0);
    r.reader.setActive(true);
    r.reader.loadPlaylist(ID, (o) => got.push(o));
    r.loads()[0].done(Object.assign(new Error("killed"), { killed: true }), "");
    assert.deepEqual(got, ["unsupported", "failed"], system);
    const thrown: LoadOutcome[] = [];
    const throwing = system === "macos" ? createMacMusic({ exec: () => assert.fail("x"), now: () => 0, every: () => () => undefined }) : createLinuxMusic({ exec: () => assert.fail("x"), now: () => 0, every: () => () => undefined });
    throwing.setActive(true);
    throwing.loadPlaylist(ID, (o) => thrown.push(o));
    assert.deepEqual(thrown, ["failed"], `${system}: a helper that throws`);
  }
});
