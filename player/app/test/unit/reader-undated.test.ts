// One rule for an answer whose age cannot be used (issue #51, item 2; ADR 0001, rule 8), the same
// in all three readers: it is never a reading and never dated "now"; the last good reading stays
// and ages by its own time; and it does not open the command gate. On macOS and Linux the age is
// unusable when the clock did not move forward across the call; on Windows when the system's own
// times for a playing position say nothing about now. Fake helpers: no process is started.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LINK_CONFIG, isCurrent } from "../../src/core/link/index.ts";
import { createWindowsMusic } from "../../src/main/readers/windows-reader.ts";
import { midpoint } from "../../src/main/polled-reader.ts";
import { RIGS } from "./reader-rigs.ts";
import { createHarness, noSession, sessionLine } from "./windows-harness.ts";

const STALE = DEFAULT_LINK_CONFIG.staleMs;

test("a call is dated at its midpoint, and not at all when the clock did not move forward across it", () => {
  const called = (began: number, ended: number) => ({ out: "", started: true, began, ended });
  assert.equal(midpoint(called(1000, 1080)), 1040);
  assert.equal(midpoint(called(1000, 1000)), 1000);
  for (const [began, ended] of [
    [1000, 999],
    [Number.NaN, 1000],
    [1000, Number.NaN],
    [1000, Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY, 1000],
  ]) {
    assert.equal(midpoint(called(began, ended)), null, `${began}..${ended}`);
  }
});

for (const [system, make] of RIGS) {
  for (const [label, end] of [
    ["runs backwards", 1200],
    ["is not a number", Number.NaN],
    ["is infinite", Number.POSITIVE_INFINITY],
  ] as const) {
    test(`${system}: a clock that ${label} across the call: no reading is made of it, and the last one ages`, () => {
      const r = make();
      r.clock.t = 1000;
      r.reader.setActive(true);
      r.last("read").ok(r.out.playing);
      const good = r.reader.latest(1000);
      assert.equal(good?.seenAt, 1000);
      assert.ok(good);

      r.clock.t = 1250;
      r.tick();
      r.clock.t = end;
      r.last("read").ok(r.out.paused);
      r.clock.t = 1300;
      assert.equal(r.reader.latest(1300), good, "the answer did not become a reading");
      assert.equal(isCurrent(good, 1000 + STALE, STALE), true);
      assert.equal(isCurrent(good, 1001 + STALE, STALE), false, "it goes stale by its own time");

      r.clock.t = 1500;
      r.tick();
      r.last("read").ok(r.out.paused);
      assert.deepEqual([r.reader.latest(1500)?.playing, r.reader.latest(1500)?.seenAt], [false, 1500], "a call with a usable time is a reading again");
    });

    test(`${system}: a clock that ${label} across the very first call: the gate stays shut, and what waited is given up`, () => {
      const r = make();
      r.clock.t = 2000;
      r.reader.setActive(true);
      r.reader.send("next");
      r.clock.t = end;
      r.last("read").ok(r.out.playing);
      assert.equal(r.reader.latest(2000), null);
      assert.equal(r.count("next"), 0, "nothing is sent on an answer that cannot be dated");

      r.clock.t = 2250;
      r.tick();
      r.last("read").ok(r.out.playing);
      assert.equal(r.count("next"), 0, "and it does not go late");
      r.reader.send("pause");
      assert.equal(r.count("pause"), 1);
    });
  }
}

const UNDATED = sessionLine({ positionMs: 0, lastUpdatedUtcMs: -11_644_473_600_000 });

test("Windows: a playing line with no usable age: the last good reading stays and ages, as on macOS and Linux", () => {
  const h = createHarness();
  const r = createWindowsMusic(h.deps);
  r.setActive(true);
  h.child.line(sessionLine());
  const good = r.latest(h.now);
  const seen = h.now;
  assert.ok(good);
  for (const line of [UNDATED, sessionLine({ nowUtcMs: 1_793_999_999_999 }), sessionLine({ nowUtcMs: 1_794_003_600_000 })]) {
    h.advance(250);
    h.child.line(line);
    assert.equal(r.latest(h.now), good, "not dropped, and not replaced");
  }
  assert.equal(isCurrent(good, seen + STALE, STALE), true);
  assert.equal(isCurrent(good, seen + STALE + 1, STALE), false);
  h.advance(250);
  h.child.line(sessionLine({ title: "Dated again" }));
  assert.equal(r.latest(h.now)?.title, "Dated again");
  assert.equal(h.children.length, 1, "such a line is one the helper is meant to write: the helper is not replaced");
});

test("Windows: a line with no usable age does not open the command gate, and what waited is given up", () => {
  const h = createHarness();
  const r = createWindowsMusic(h.deps);
  r.setActive(true);
  r.send("next");
  h.child.line(UNDATED);
  assert.deepEqual(h.child.written, [], "an undated first line is not the first good answer");
  h.advance(250);
  h.child.line(noSession());
  assert.deepEqual(h.child.written, [], "and the command does not go late");
  r.send("pause");
  assert.deepEqual(h.child.written, ["pause\n"], "once a good line has come, a command goes at once");
});

test("Windows: lines with no usable age keep the helper alive, and one of them still tells that a command was read", () => {
  const h = createHarness();
  const r = createWindowsMusic(h.deps);
  r.setActive(true);
  h.child.line(noSession());
  r.send("pause");
  r.send("next");
  for (let i = 0; i < 100; i++) {
    h.advance(250);
    h.child.line(UNDATED);
  }
  assert.equal(h.child.killed, false);
  assert.deepEqual(h.child.written, ["pause\n"]);
  h.advance(250);
  h.child.line(sessionLine({ positionMs: 0, lastUpdatedUtcMs: -11_644_473_600_000, commands: 1 }));
  assert.deepEqual(h.child.written, ["pause\n", "next\n"]);
});
