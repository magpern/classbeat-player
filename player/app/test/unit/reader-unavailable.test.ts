// A helper that can never run (issue #51, item 7; #45 N2, #50 N4): osascript or busctl is not
// there, PowerShell is missing or its script is refused. After six failures to start in a row
// the reader stops for good and says following is unavailable; the shell then goes to the manual
// clock, no longer offers to follow, and says why on the Music link line. A helper that starts
// and then fails (Spotify closed, no session bus, a timeout, garbage, the Windows script's own
// failed line) is never counted. Fake helpers: no process is started.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { START_FAILURES_LIMIT } from "../../src/core/link/reader-lifecycle.ts";
import { createController } from "../../src/main/controller.ts";
import { createLinuxMusic } from "../../src/main/linux-reader.ts";
import { createMacMusic } from "../../src/main/macos-reader.ts";
import { couldNotStart } from "../../src/main/polled-reader.ts";
import { backoffMs } from "../../src/main/readers/helper-supervisor.ts";
import { createWindowsMusic, HELPER_FAILED_LINE, WINDOWS_HELPER_LIMITS as LIMITS } from "../../src/main/readers/windows-reader.ts";
import { WINDOWS_HELPER_SCRIPT } from "../../src/main/readers/windows-script.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { converterExamples, REPO } from "./fixtures.ts";
import { FAILED, NOT_INSTALLED, RIGS, macRig } from "./reader-rigs.ts";
import { createHarness, noSession, sessionLine } from "./windows-harness.ts";

const text = readFileSync(converterExamples()[0], "utf8");
const first = (JSON.parse(text) as Class).songs[0];

test("only the system's errors for a program that is missing or may not be run count as a failure to start", () => {
  for (const code of ["ENOENT", "EACCES", "EPERM", "ENOEXEC"]) assert.equal(couldNotStart(Object.assign(new Error("spawn"), { code })), true, code);
  const ran = [
    null,
    undefined,
    new Error("failed"),
    Object.assign(new Error("exit 1"), { code: 1 }),
    Object.assign(new Error("killed"), { killed: true, signal: "SIGKILL", code: null }),
    Object.assign(new Error("maxBuffer"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
    Object.assign(new Error("again"), { code: "EAGAIN" }),
    Object.assign(new Error("files"), { code: "EMFILE" }),
    Object.assign(new Error("lower case"), { code: "enoent" }),
    Object.assign(new Error("a list"), { code: ["ENOENT"] }),
    "ENOENT",
  ];
  for (const error of ran) assert.equal(couldNotStart(error), false, String(error));
});

for (const [system, make] of RIGS) {
  test(`${system}: the program is not there: after six polls the reader stops for good and says so`, () => {
    const r = make();
    r.missing = true;
    r.reader.setActive(true);
    for (let i = 1; i < START_FAILURES_LIMIT; i++) {
      assert.equal(r.reader.unavailable(), false, `after ${i} failures`);
      r.step();
    }
    assert.equal(r.reader.unavailable(), true);
    assert.equal(r.count("read"), START_FAILURES_LIMIT);
    assert.equal(r.calls.length, START_FAILURES_LIMIT, "nothing but the read was ever tried");
    assert.equal(r.reader.latest(r.clock.t), null);

    // It is over: no timer, no call, no command, and Follow cannot turn it on again.
    r.missing = false;
    r.step();
    r.reader.setActive(true);
    r.reader.setActive(false);
    r.reader.setActive(true);
    r.reader.send("play");
    r.step();
    assert.equal(r.calls.length, START_FAILURES_LIMIT);
    assert.equal(r.reader.unavailable(), true);
  });

  test(`${system}: a program that starts and fails is never counted, however long it goes on`, () => {
    const failures: readonly ((r: ReturnType<typeof make>) => void)[] = [
      (r) => r.last("read").fail(FAILED()),
      (r) => r.last("read").fail(Object.assign(new Error("killed"), { killed: true, signal: "SIGKILL" })),
      (r) => r.last("read").fail(Object.assign(new Error("maxBuffer"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" })),
      (r) => r.last("read").ok("garbage\n"),
    ];
    const r = make();
    r.reader.setActive(true);
    for (let i = 0; i < 200; i++) {
      failures[i % failures.length](r);
      r.step();
    }
    assert.equal(r.reader.unavailable(), false);
    assert.equal(r.count("read"), 201, "it keeps asking");
  });

  test(`${system}: the failures must come in a row: one call that starts begins the count again`, () => {
    const r = make();
    r.reader.setActive(true);
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < START_FAILURES_LIMIT - 1; i++) {
        r.last("read").fail(NOT_INSTALLED());
        r.step();
      }
      r.last("read").fail(FAILED());
      r.step();
    }
    assert.equal(r.reader.unavailable(), false);
    for (let i = 0; i < START_FAILURES_LIMIT; i++) {
      r.last("read").fail(NOT_INSTALLED());
      r.step();
    }
    assert.equal(r.reader.unavailable(), true);
  });
}

test("a start that throws counts as a failure to start, on macOS and on Linux", () => {
  for (const create of [createMacMusic, createLinuxMusic]) {
    let tick: () => void = () => undefined;
    let tries = 0;
    const reader = create({
      exec: () => {
        tries += 1;
        throw new Error("spawn failed");
      },
      now: () => 0,
      every: (fn) => ((tick = fn), () => undefined),
    });
    reader.setActive(true);
    for (let i = 0; i < 20; i++) tick();
    assert.equal(reader.unavailable(), true);
    assert.equal(tries, START_FAILURES_LIMIT, "and nothing is tried after that");
  }
});

function windows(): { h: ReturnType<typeof createHarness>; r: ReturnType<typeof createWindowsMusic> } {
  const h = createHarness();
  return { h, r: createWindowsMusic(h.deps) };
}

test("Windows: a helper that cannot be started is tried six times with the growing wait, then never again", () => {
  const { h, r } = windows();
  h.failSpawn = true;
  r.setActive(true);
  // Tries at 0, 1, 3, 7, 15 and 31 s.
  h.advance(30_999);
  assert.equal(r.unavailable(), false, "five failures: the sixth try is still to come");
  h.advance(1);
  assert.equal(r.unavailable(), true);
  h.failSpawn = false;
  h.advance(600_000);
  r.setActive(false);
  r.setActive(true);
  r.send("play");
  h.advance(600_000);
  assert.equal(h.children.length, 0, "no restart every 30 s, and none on Follow");
  assert.equal(r.latest(h.now), null);
});

test("Windows: a helper that ends, or hangs, before its first good line counts as a failure to start", () => {
  const died = windows();
  died.r.setActive(true);
  for (let i = 1; i <= START_FAILURES_LIMIT; i++) {
    assert.equal(died.h.children.length, i);
    assert.equal(died.r.unavailable(), false);
    // What it writes is not the script's: an error text, and lines of the wrong shape.
    died.h.child.line("The term 'Add-Type' is not recognized");
    died.h.child.line('{"error":false}');
    died.h.child.line('{"error":true,"commands":0}');
    died.h.child.die();
    died.h.advance(backoffMs(i));
  }
  assert.equal(died.r.unavailable(), true);
  died.h.advance(600_000);
  assert.equal(died.h.children.length, START_FAILURES_LIMIT);

  const hung = windows();
  hung.r.setActive(true);
  for (let i = 1; i <= START_FAILURES_LIMIT; i++) {
    assert.equal(hung.r.unavailable(), false);
    hung.h.advance(LIMITS.startTimeoutMs + backoffMs(i));
  }
  assert.equal(hung.r.unavailable(), true);
  assert.equal(hung.h.children.length, START_FAILURES_LIMIT);
  assert.ok(hung.h.children.every((c) => c.killed));
});

test("Windows: each helper has to show for itself that it runs: one that worked does not vouch for six that never start", () => {
  const { h, r } = windows();
  r.setActive(true);
  h.child.line(sessionLine());
  h.child.line(HELPER_FAILED_LINE);
  h.failSpawn = true;
  h.child.die();
  // The helper that had run is the first failure of the wait, not a failure to start: six more tries.
  h.advance(1000 + 2000 + 4000 + 8000 + 16_000 + 30_000 - 1);
  assert.equal(r.unavailable(), false);
  h.advance(1);
  assert.equal(r.unavailable(), true);
  assert.equal(h.children.length, 1);
});

// The reviewer's probe on #59 (B1): the script runs, and its polls fail (a call to Spotify's
// session times out, say). That is an outage, not a helper that can never run.
test("Windows: good readings, then only the script's failed line: replaced as before, never unavailable, and following comes back", () => {
  assert.equal(HELPER_FAILED_LINE, '{"error":true}');
  assert.ok(WINDOWS_HELPER_SCRIPT.includes(`  $line = '${HELPER_FAILED_LINE}'\n`), "the very line the script writes for a failed poll");
  const { h, r } = windows();
  r.setActive(true);
  h.child.line(sessionLine());
  assert.equal(r.latest(h.now)?.title, "Spike Song A");
  // An hour of failed polls, four a second.
  for (let i = 0; i < 4 * 3600; i++) {
    h.advance(250);
    if (!h.child.killed) h.child.line(HELPER_FAILED_LINE);
    assert.equal(r.unavailable(), false, `after ${i} polls`);
  }
  assert.ok(h.children.length > 100, "it was replaced again and again, every 30 s at the slowest");
  assert.equal(r.latest(h.now), null);
  // The fault clears: the helper running then, or the next one, reads again.
  while (h.child.killed) h.advance(250);
  h.child.line(sessionLine({ title: "Back" }));
  assert.equal(r.latest(h.now)?.title, "Back");
  assert.equal(r.unavailable(), false);
});

test("Windows: a helper whose every poll fails from its very first line has started: it is never counted", () => {
  const { h, r } = windows();
  r.setActive(true);
  for (let i = 0; i < 4 * 600; i++) {
    h.advance(250);
    if (!h.child.killed) h.child.line(i % 2 === 0 ? HELPER_FAILED_LINE : ` ${HELPER_FAILED_LINE}\r`);
  }
  assert.equal(r.unavailable(), false);
  assert.ok(h.children.length > START_FAILURES_LIMIT);
  // One failed line is proof enough, even from a helper that then dies or goes quiet.
  for (let i = 0; i < 20; i++) {
    while (h.child.killed) h.advance(250);
    h.child.line(HELPER_FAILED_LINE);
    if (i % 2 === 0) h.child.die();
    else h.advance(LIMITS.startTimeoutMs);
  }
  assert.equal(r.unavailable(), false);
});

test("Windows: a helper that has spoken and then dies is replaced as before, however often; one good line begins the count again", () => {
  const { h, r } = windows();
  r.setActive(true);
  for (let i = 1; i <= 30; i++) {
    h.child.line(noSession());
    h.child.die();
    h.advance(backoffMs(i));
  }
  assert.equal(r.unavailable(), false);
  assert.equal(h.children.length, 31);

  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < START_FAILURES_LIMIT - 1; i++) {
      h.child.die();
      h.advance(30_000);
    }
    h.child.line(sessionLine());
  }
  assert.equal(r.unavailable(), false);
  assert.equal(r.latest(h.now)?.title, "Spike Song A");
});

test("in the shell: following that cannot work goes to the manual clock, and Follow is no longer offered", () => {
  const r = macRig();
  r.missing = true;
  const c = createController(() => r.clock.t, r.reader, r.reader);
  assert.equal(c.open("a.json", text).link?.available, true, "offered until it is known not to work");
  c.command({ type: "start" });
  assert.equal(c.command({ type: "follow" }).link?.mode, "following");
  assert.equal(c.snapshot().link?.unavailable, false);
  for (let i = 1; i < START_FAILURES_LIMIT; i++) r.step();
  const snap = c.snapshot();
  assert.deepEqual([snap.link?.mode, snap.link?.state, snap.link?.available], ["manual", "Manual", false]);
  assert.equal(snap.link?.unavailable, true, "and the link says why");
  assert.equal(snap.link?.guessing, false);
  assert.equal(snap.link?.announcement, null);
  assert.equal(snap.view?.status, "running", "the class clock goes on as it was");
  assert.equal(snap.view?.classMs, r.clock.t);

  // Follow does nothing now, music commands go nowhere, and the manual clock works as ever.
  const calls = r.calls.length;
  assert.equal(c.command({ type: "follow" }).link?.mode, "manual");
  c.music("play");
  r.step();
  assert.equal(r.calls.length, calls);
  assert.equal(c.command({ type: "pause" }).view?.status, "paused");
  // A class opened later is manual only, as with no reader at all.
  const again = c.open("b.json", text);
  assert.deepEqual([again.link?.mode, again.link?.available, again.link?.unavailable], ["manual", false, true]);
  assert.equal(c.command({ type: "follow" }).link?.mode, "manual");
  assert.equal(r.calls.length, calls);
  c.stop();
});

test("in the shell: a reader that worked and then loses its program leaves a locked class running on the manual clock", () => {
  const r = macRig();
  const c = createController(() => r.clock.t, r.reader, r.reader);
  c.open("a.json", text);
  c.command({ type: "follow" });
  r.last("read").ok(`playing\tspotify:track:X\t${first.title}\t${first.artist}\t20\t${first.length_ms}\n`);
  assert.equal(c.snapshot().link?.state, "Locked");
  r.missing = true;
  for (let i = 0; i < START_FAILURES_LIMIT; i++) r.step();
  const snap = c.snapshot();
  assert.deepEqual([snap.link?.mode, snap.link?.state, snap.link?.available], ["manual", "Manual", false]);
  assert.equal(snap.view?.status, "running");
  assert.equal(snap.view?.classMs, first.start_ms + 20_000 + r.clock.t, "from where the music was, at the clock's own pace");
  c.stop();
});

test("in the shell (Windows): six failed starts, then the manual clock; the helper is not started again", () => {
  const h = createHarness();
  h.failSpawn = true;
  const music = createWindowsMusic(h.deps);
  const c = createController(() => h.now, music, music);
  c.open("a.json", text);
  c.command({ type: "follow" });
  h.advance(30_000);
  assert.deepEqual([c.snapshot().link?.mode, c.snapshot().link?.available], ["following", true], "still trying");
  h.advance(1000);
  const snap = c.snapshot();
  assert.deepEqual([snap.link?.mode, snap.link?.state, snap.link?.available, snap.link?.unavailable], ["manual", "Manual", false, true]);
  h.failSpawn = false;
  c.command({ type: "follow" });
  c.open("b.json", text);
  c.command({ type: "follow" });
  h.advance(600_000);
  assert.equal(h.children.length, 0);
  c.stop();
});

test("the reason is shown: the Music link line stays, with the words, and the manual clock is untouched", () => {
  const src = join(REPO, "player", "app", "src");
  const html = readFileSync(join(src, "renderer", "presenter.html"), "utf8");
  // The same line as before, with one more hidden span in it: no new element around it.
  assert.ok(html.includes('<p>Music link: <output id="link-state"></output><span id="link-unavailable" hidden> (following the music is unavailable on this computer)</span><span id="link-guess" hidden>'));
  assert.equal(html.match(/unavailable on this computer/g)?.length, 1);
  const presenter = readFileSync(join(src, "renderer", "presenter.ts"), "utf8");
  assert.ok(presenter.includes('  hide("link-unavailable", !k.unavailable);\n'));
  assert.ok(presenter.includes('  hide("link", k === null);\n'), "the line itself is hidden only when no class is open");

  // A reader that works, the manual reader, and a class before Follow never say it.
  const r = macRig();
  const c = createController(() => r.clock.t, r.reader, r.reader);
  assert.equal(c.open("a.json", text).link?.unavailable, false);
  c.command({ type: "follow" });
  r.last("read").ok(r.out.playing);
  assert.equal(c.snapshot().link?.unavailable, false);
  c.stop();
  assert.equal(createController(() => 0).open("a.json", text).link?.unavailable, false);
});
