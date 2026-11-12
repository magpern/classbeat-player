// The reader inside the shell: which reader a system gets, when the controller lets it run
// (only after the instructor picks "Follow the music"), and the three named music commands.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { manualReader } from "../../src/core/link/index.ts";
import type { Observation } from "../../src/core/link/index.ts";
import { MUSIC_ACTIONS, parseMusicCommand } from "../../src/core/music-command.ts";
import type { MusicAction } from "../../src/core/music-command.ts";
import { parseClockCommand } from "../../src/core/commands.ts";
import { createController } from "../../src/main/controller.ts";
import { READER_FACTORIES, selectReader } from "../../src/main/readers/select.ts";
import type { ShellReader } from "../../src/main/readers/shell-reader.ts";
import { createWindowsReader } from "../../src/main/readers/windows-reader.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { converterExamples, EXAMPLES } from "./fixtures.ts";
import { createHarness, sessionLine } from "./windows-harness.ts";
import { join } from "node:path";

const text = readFileSync(converterExamples()[0], "utf8");
const first = (JSON.parse(text) as Class).songs[0];
const REFUSED = readFileSync(join(EXAMPLES, "reader", "rejected-unknown-major.json"), "utf8");

test("music commands: exactly play, pause and next, by name", () => {
  assert.deepEqual([...MUSIC_ACTIONS], ["play", "pause", "next"]);
  for (const action of MUSIC_ACTIONS) assert.deepEqual(parseMusicCommand({ type: "music", action }), { type: "music", action });
  const proto = Object.create({ type: "music", action: "play" });
  for (const bad of [
    null,
    "play",
    ["music", "play"],
    proto,
    { type: "music" },
    { action: "play" },
    { type: "music", action: "previous" },
    { type: "music", action: "seek" },
    { type: "music", action: "Play" },
    { type: "music", action: "play\n" },
    { type: "music", action: "next; calc.exe" },
    { type: "music", action: ["play"] },
    { type: "music", action: { toString: () => "play" } },
    { type: "music", action: "play", extra: 1 },
    { type: "music", action: "play", script: "x" },
    { type: "Music", action: "play" },
    { type: "play" },
  ]) {
    assert.equal(parseMusicCommand(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseClockCommand({ type: "music", action: "play" }), null, "never mistaken for a clock command");
});

test("the reader is chosen by platform, and no other platform's reader is ever constructed", () => {
  let made = 0;
  const fake: ShellReader = { kind: "windows", latest: () => null };
  const factories = { win32: () => ((made += 1), fake) };
  for (const p of ["linux", "darwin", "freebsd", "android", "constructor", "__proto__"] as NodeJS.Platform[]) {
    assert.equal(selectReader(p, factories), manualReader, p);
  }
  assert.equal(made, 0);
  assert.equal(selectReader("win32", factories), fake);
  assert.equal(made, 1);
});

test("only Windows has a reader factory here, and this system gets the manual reader unless it is Windows", () => {
  assert.deepEqual(Object.keys(READER_FACTORIES), ["win32"]);
  for (const p of ["linux", "darwin"] as const) assert.equal(selectReader(p), manualReader);
  if (process.platform !== "win32") assert.equal(selectReader(process.platform), manualReader);
});

interface Spy extends ShellReader {
  readonly calls: string[];
  reading: Observation | null;
}

function spyReader(): Spy {
  const spy: Spy = {
    kind: "windows",
    calls: [],
    reading: null,
    latest: () => spy.reading,
    setFollowing: (on) => void spy.calls.push(`following:${on}`),
    control: (action: MusicAction) => void spy.calls.push(`control:${action}`),
    close: () => void spy.calls.push("close"),
  };
  return spy;
}

test("a class opens on the manual clock; the reader runs only once the instructor follows", () => {
  let now = 0;
  const reader = spyReader();
  const c = createController(() => now, reader);
  assert.deepEqual([...reader.calls], [], "nothing before a class is open");

  const opened = c.open("a.json", text);
  assert.equal(opened.link?.mode, "manual");
  assert.equal(opened.link?.available, true, "following is offered");
  assert.deepEqual([...reader.calls], ["following:false"]);

  now = 1000;
  assert.equal(c.command({ type: "start" }).link?.mode, "manual");
  assert.equal(reader.calls.includes("following:true"), false, "starting the class is not following");

  assert.equal(c.command({ type: "follow" }).link?.mode, "following");
  assert.equal(reader.calls.at(-1), "following:true");

  assert.equal(c.command({ type: "manual" }).link?.mode, "manual");
  assert.equal(reader.calls.at(-1), "following:false");
});

test("a refused file leaves the open class following; a new class is on the manual clock again", () => {
  const reader = spyReader();
  const c = createController(() => 0, reader);
  c.open("a.json", text);
  c.command({ type: "follow" });
  const refused = c.open("b.json", REFUSED);
  assert.ok(refused.error);
  assert.equal(refused.link?.mode, "following");
  assert.equal(reader.calls.at(-1), "following:true");
  assert.equal(c.open("c.json", text).link?.mode, "manual");
  assert.equal(reader.calls.at(-1), "following:false");
});

test("music commands reach the reader only while following, and stop closes the reader", () => {
  const reader = spyReader();
  const c = createController(() => 0, reader);
  c.music("play");
  c.open("a.json", text);
  c.music("next");
  assert.equal(reader.calls.some((x) => x.startsWith("control:")), false, "no class, or the manual clock: nothing is sent");
  c.command({ type: "follow" });
  assert.equal(c.music("pause").link?.mode, "following");
  c.music("next");
  assert.deepEqual(reader.calls.slice(-2), ["control:pause", "control:next"]);
  c.stop();
  assert.equal(reader.calls.at(-1), "close");
});

test("with the manual reader nothing can be followed and music commands do nothing", () => {
  const c = createController(() => 0);
  assert.equal(c.open("a.json", text).link?.available, false);
  assert.equal(c.command({ type: "follow" }).link?.mode, "manual");
  assert.doesNotThrow(() => c.music("play"));
  assert.doesNotThrow(() => c.stop());
});

test("the Windows reader in the shell: follow, lock on the helper's reading, coast when it hangs or dies", () => {
  const h = createHarness();
  const c = createController(() => h.now, createWindowsReader(h.deps));
  c.open("a.json", text);
  h.advance(5000);
  assert.equal(h.children.length, 0, "no helper while on the manual clock");

  c.command({ type: "follow" });
  assert.equal(h.children.length, 1);
  const line = (positionMs: number): string => sessionLine({ title: first.title, artist: first.artist, endMs: first.length_ms, positionMs, nowUtcMs: 1_794_000_000_000 });
  h.child.line(line(20_000));
  let snap = c.snapshot();
  assert.equal(snap.link?.state, "Locked");
  assert.equal(snap.view?.classMs, first.start_ms + 20_000);

  c.music("next");
  assert.deepEqual(h.child.written, ["next\n"]);

  h.advance(2000);
  assert.equal(c.snapshot().link?.state, "Locked", "an ageing reading is extrapolated while it is fresh");
  h.advance(1000);
  snap = c.snapshot();
  assert.equal(snap.link?.state, "Coasting", "within 3 s of the helper going quiet");
  assert.equal(snap.view?.status, "running", "the class clock runs on");

  h.advance(4000);
  assert.equal(h.children.length, 2, "the hung helper was dropped after 5 s and replaced a second later");
  h.child.line(line(90_000));
  assert.equal(c.snapshot().link?.state, "Locked");
  h.child.die();
  assert.equal(c.snapshot().link?.state, "Coasting", "a dead helper gives no reading");

  c.command({ type: "manual" });
  const count = h.children.length;
  h.advance(120_000);
  assert.equal(h.children.length, count, "and on the manual clock it is not restarted");
});
