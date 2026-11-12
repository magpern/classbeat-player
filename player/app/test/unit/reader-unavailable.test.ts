// A helper that can never run (issue #51, item 7; #45 N2, #50 N4): osascript or busctl is not
// there, PowerShell is missing or its script is refused. After six failures to start in a row
// the reader stops for good and says following is unavailable; the shell then goes to the manual
// clock and no longer offers to follow. A helper that starts and then fails (Spotify closed, no
// session bus, a timeout, garbage) is never counted. Fake helpers: no process is started.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { START_FAILURES_LIMIT } from "../../src/core/link/reader-lifecycle.ts";
import { createController } from "../../src/main/controller.ts";
import { createLinuxMusic } from "../../src/main/linux-reader.ts";
import { createMacMusic } from "../../src/main/macos-reader.ts";
import { couldNotStart } from "../../src/main/polled-reader.ts";
import { backoffMs } from "../../src/main/readers/helper-supervisor.ts";
import { createWindowsMusic, WINDOWS_HELPER_LIMITS as LIMITS } from "../../src/main/readers/windows-reader.ts";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { converterExamples } from "./fixtures.ts";
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
    died.h.child.line('{"error":true}');
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
  for (let i = 1; i < START_FAILURES_LIMIT; i++) r.step();
  const snap = c.snapshot();
  assert.deepEqual([snap.link?.mode, snap.link?.state, snap.link?.available], ["manual", "Manual", false]);
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
  assert.deepEqual([again.link?.mode, again.link?.available], ["manual", false]);
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
  assert.deepEqual([snap.link?.mode, snap.link?.state, snap.link?.available], ["manual", "Manual", false]);
  h.failSpawn = false;
  c.command({ type: "follow" });
  c.open("b.json", text);
  c.command({ type: "follow" });
  h.advance(600_000);
  assert.equal(h.children.length, 0);
  c.stop();
});
