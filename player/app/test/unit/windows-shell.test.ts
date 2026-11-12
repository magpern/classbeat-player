// The Windows reader inside the shell: chosen on Windows only, running only after the instructor
// picks "Follow the music", and reached by the three named music commands. No process is started.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { manualReader } from "../../src/core/link/index.ts";
import type { MusicReader } from "../../src/core/link/index.ts";
import type { MusicTransport } from "../../src/core/link/transport.ts";
import { createController } from "../../src/main/controller.ts";
import { createWindowsMusic } from "../../src/main/readers/windows-reader.ts";
import { selectMusic } from "../../src/main/select-music.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { converterExamples, EXAMPLES } from "./fixtures.ts";
import { createHarness, NO_SESSION, noSession, OTHER_APP, sessionLine } from "./windows-harness.ts";
import { REPO } from "./fixtures.ts";

const text = readFileSync(converterExamples()[0], "utf8");
const first = (JSON.parse(text) as Class).songs[0];
const REFUSED = readFileSync(join(EXAMPLES, "reader", "rejected-unknown-major.json"), "utf8");
const never = (): MusicReader & MusicTransport => assert.fail("constructed");
const line = (positionMs: number): string => sessionLine({ title: first.title, artist: first.artist, endMs: first.length_ms, positionMs, nowUtcMs: 1_794_000_000_000 });

test("the Windows reader is chosen on Windows, and constructing it starts nothing", () => {
  const h = createHarness();
  let made = 0;
  const chosen = selectMusic("win32", never, () => ((made += 1), createWindowsMusic(h.deps)));
  assert.equal(made, 1);
  assert.equal(chosen.reader.kind, "windows");
  assert.equal(chosen.transport, chosen.reader, "the same object reads and passes the commands on");
  h.advance(60_000);
  assert.equal(h.children.length, 0);
});

for (const platform of ["linux", "darwin", "freebsd", "", "Win32", "win32 ", "windows"]) {
  test(`on "${platform}" the Windows reader is never constructed`, () => {
    const mac = { kind: "macos" as const, latest: () => null, send: () => undefined };
    const linux = { kind: "linux" as const, latest: () => null, send: () => undefined };
    const chosen = selectMusic(platform, () => mac, never, () => linux);
    assert.equal(chosen.reader, platform === "darwin" ? mac : platform === "linux" ? linux : manualReader);
  });
}

test("the real selection on this machine constructs no Windows reader unless it is Windows", { skip: process.platform === "win32" }, () => {
  assert.notEqual(selectMusic(process.platform).reader.kind, "windows");
});

function shell(): { h: ReturnType<typeof createHarness>; c: ReturnType<typeof createController> } {
  const h = createHarness();
  const music = createWindowsMusic(h.deps);
  return { h, c: createController(() => h.now, music, music) };
}

test("a class opens on the manual clock; the helper starts only when the instructor follows", () => {
  const { h, c } = shell();
  const opened = c.open("a.json", text);
  assert.equal(opened.link?.mode, "manual");
  assert.equal(opened.link?.available, true, "following is offered");
  h.advance(5000);
  c.command({ type: "start" });
  h.advance(5000);
  assert.equal(h.children.length, 0, "opening and starting a class read nothing");

  assert.equal(c.command({ type: "follow" }).link?.mode, "following");
  assert.equal(h.children.length, 1);
  assert.equal(c.command({ type: "manual" }).link?.mode, "manual");
  assert.equal(h.child.killed, true);
  h.advance(120_000);
  assert.equal(h.children.length, 1, "and on the manual clock it is not restarted");
});

test("a refused file leaves the helper running; a new class stops it until Follow is picked again", () => {
  const { h, c } = shell();
  c.open("a.json", text);
  c.command({ type: "follow" });
  assert.ok(c.open("b.json", REFUSED).error);
  assert.equal(h.child.killed, false);
  assert.equal(c.open("c.json", text).link?.mode, "manual");
  assert.equal(h.child.killed, true);
});

test("music commands reach the helper only while following; stopping the shell stops the helper", () => {
  const { h, c } = shell();
  c.music("play");
  c.open("a.json", text);
  c.music("next");
  assert.equal(h.children.length, 0, "a command never starts a helper");
  c.command({ type: "follow" });
  c.music("pause");
  assert.deepEqual(h.child.written, [], "nothing before the helper's first line");
  h.child.line(NO_SESSION);
  assert.deepEqual(h.child.written, ["pause\n"]);
  c.music("next");
  h.advance(250);
  h.child.line(NO_SESSION);
  assert.deepEqual(h.child.written, ["pause\n"], "the helper has not read the first command yet");
  h.advance(250);
  h.child.line(noSession(1));
  assert.deepEqual(h.child.written, ["pause\n", "next\n"]);
  c.command({ type: "manual" });
  h.advance(1000);
  c.music("play");
  assert.equal(h.child.written.length, 2);

  c.command({ type: "follow" });
  h.advance(1000);
  assert.equal(h.children.length, 2);
  c.stop();
  assert.equal(h.child.killed, true);
  h.advance(120_000);
  assert.equal(h.children.length, 2);
});

test("follow, lock on the helper's reading, coast when it hangs or dies, lock again on its replacement", () => {
  const { h, c } = shell();
  c.open("a.json", text);
  c.command({ type: "follow" });
  h.child.line(line(20_000));
  let snap = c.snapshot();
  assert.equal(snap.link?.state, "Locked");
  assert.equal(snap.view?.classMs, first.start_ms + 20_000);

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
});

test("another app playing while Spotify is not: Off the list within 3 s, the clock runs on, and it locks again on return", () => {
  const { h, c } = shell();
  c.open("a.json", text);
  c.command({ type: "follow" });
  h.child.line(line(20_000));
  assert.equal(c.snapshot().link?.state, "Locked");

  // Spotify is paused and a browser plays: the helper reports the browser, by its id only.
  h.advance(250);
  h.child.line(OTHER_APP);
  let snap = c.snapshot();
  assert.equal(snap.link?.state, "Off the list");
  assert.equal(snap.view?.status, "running", "the class clock runs on");
  assert.equal(snap.view?.classMs, first.start_ms + 20_250, "and the other app did not move it");
  for (let i = 0; i < 40; i++) {
    h.advance(250);
    h.child.line(OTHER_APP);
  }
  snap = c.snapshot();
  assert.equal(snap.link?.state, "Off the list");
  assert.equal(snap.view?.classMs, first.start_ms + 30_250);
  assert.equal(snap.link?.songIndex, null, "it is matched to no song");

  c.music("next");
  h.advance(250);
  h.child.line(line(45_000));
  snap = c.snapshot();
  assert.equal(snap.link?.state, "Locked", "Spotify plays again");
  assert.equal(snap.view?.classMs, first.start_ms + 45_000);
});

test("another app playing before anything was followed never moves the class", () => {
  const { h, c } = shell();
  c.open("a.json", text);
  c.command({ type: "follow" });
  h.child.line(OTHER_APP);
  const snap = c.snapshot();
  assert.equal(snap.link?.state, "Off the list");
  assert.equal(snap.view?.status, "ready");
  assert.equal(snap.view?.classMs, 0);
});

test("a playing session that never dated its position is not followed: the class is not shown as locked", () => {
  const { h, c } = shell();
  c.open("a.json", text);
  c.command({ type: "follow" });
  for (let i = 0; i < 40; i++) {
    h.advance(250);
    h.child.line(sessionLine({ title: first.title, artist: first.artist, endMs: first.length_ms, positionMs: 0, lastUpdatedUtcMs: -11_644_473_600_000 }));
    assert.equal(c.snapshot().link?.state, "Manual");
  }
  assert.equal(c.snapshot().view?.status, "ready");
});

test("quitting the application stops the controller, and with it a running helper", () => {
  const main = readFileSync(join(REPO, "player", "app", "src", "main", "main.ts"), "utf8");
  assert.match(main, /\n {2}app\.on\("will-quit", \(\) => controller\.stop\(\)\);\n/, "quitting from the menu skips window-all-closed");
  assert.match(main, /app\.on\("window-all-closed", \(\) => \{\n {4}controller\.stop\(\);/);
  const { h, c } = shell();
  c.open("a.json", text);
  c.command({ type: "follow" });
  c.stop();
  c.stop();
  assert.equal(h.child.killed, true);
  h.advance(120_000);
  assert.equal(h.children.length, 1, "and it stays stopped");
});
