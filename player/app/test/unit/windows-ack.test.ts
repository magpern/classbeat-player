// Commands across a stall (issue #51, item 5; #45 N7). A command written to the Windows helper
// stays in flight until the helper says it has read it: every line carries the number of command
// lines the helper has read from its input, and only a line whose number has reached the number
// written counts. Lines the helper wrote earlier never do, however many arrive together. A fake
// helper: nothing here starts a process.
import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffMs } from "../../src/main/readers/helper-supervisor.ts";
import { createWindowsMusic, WINDOWS_HELPER_LIMITS as LIMITS } from "../../src/main/readers/windows-reader.ts";
import type { WindowsMusic } from "../../src/main/readers/windows-reader.ts";
import { createHarness, noSession, otherApp, sessionLine } from "./windows-harness.ts";
import type { Harness } from "./windows-harness.ts";

/** Following, with the helper's first good line in: the gate is open. */
function ready(): { h: Harness; r: WindowsMusic } {
  const h = createHarness();
  const r = createWindowsMusic(h.deps);
  r.setActive(true);
  h.child.line(noSession());
  return { h, r };
}

test("two buffered lines arriving together after a write are not the command's answer", () => {
  const { h, r } = ready();
  r.send("next");
  r.send("pause");
  assert.deepEqual(h.child.written, ["next\n"]);
  // The application stalled: the helper had written these before it read its input.
  h.child.emit(`${noSession(0)}\n${sessionLine()}\n${noSession(0)}\n`);
  assert.deepEqual(h.child.written, ["next\n"], "the second command is not written on top of the first");
  for (let i = 0; i < 40; i++) {
    h.advance(100);
    h.child.line(noSession(0));
  }
  assert.deepEqual(h.child.written, ["next\n"], "however many such lines come, and however late");
  h.child.line(noSession(1));
  assert.deepEqual(h.child.written, ["next\n", "pause\n"], "the helper has read the first: the one that waited follows");
});

test("any kind of line the helper means to write can say the command was read", () => {
  for (const line of [noSession(1), sessionLine({ commands: 1 }), sessionLine({ status: "Paused", commands: 1 }), sessionLine({ status: "Changing", commands: 1 }), otherApp("Chrome", "Paused", 1)]) {
    const { h, r } = ready();
    r.send("next");
    r.send("pause");
    h.child.line(line);
    assert.deepEqual(h.child.written, ["next\n", "pause\n"], line);
  }
});

test("garbage and the helper's failed line say nothing about a command", () => {
  const { h, r } = ready();
  r.send("next");
  r.send("pause");
  for (const line of ['{"error":true}', '{"error":true,"commands":1}', '{"commands":1}', "1", '{"app":null,"commands":"1"}']) h.child.line(line);
  assert.deepEqual(h.child.written, ["next\n"]);
});

test("a line that claims more commands than were written is not one the helper is meant to write", () => {
  const { h, r } = ready();
  h.child.line(sessionLine());
  const good = r.latest(h.now);
  h.advance(250);
  h.child.line(sessionLine({ title: "Liar", commands: 1 }));
  assert.equal(r.latest(h.now), good, "it gives no reading");
  r.send("next");
  r.send("pause");
  h.child.line(noSession(2));
  assert.deepEqual(h.child.written, ["next\n"], "and it is no answer to a command");
  for (let i = 0; i < LIMITS.maxGarbageLines - 3; i++) h.child.line(noSession(99));
  assert.equal(h.child.killed, false);
  h.child.line(noSession(99));
  assert.equal(h.child.killed, true, "a run of such lines replaces the helper, like any garbage");
});

test("the count starts again with each helper: a replacement's lines are judged against what was written to it", () => {
  const { h, r } = ready();
  r.send("next");
  h.child.line(noSession(1));
  r.send("next");
  h.child.line(noSession(2));
  assert.deepEqual(h.child.written, ["next\n", "next\n"]);
  h.child.die();
  h.advance(backoffMs(1));
  assert.equal(h.children.length, 2);
  h.child.line(noSession(2));
  assert.equal(r.latest(h.now), null);
  r.send("play");
  assert.deepEqual(h.child.written, [], "a line counting the old helper's commands is garbage to the new one: the gate stays shut");
  h.child.line(noSession(0));
  assert.deepEqual(h.child.written, ["play\n"], "its own first good line opens it");
  r.send("next");
  h.child.line(noSession(0));
  assert.deepEqual(h.child.written, ["play\n"]);
  h.child.line(noSession(1));
  assert.deepEqual(h.child.written, ["play\n", "next\n"]);

  // The same when following is turned off and on.
  r.setActive(false);
  r.setActive(true);
  h.advance(LIMITS.minGapMs);
  assert.equal(h.children.length, 3);
  h.child.line(noSession(0));
  r.send("play");
  r.send("pause");
  h.child.line(noSession(1));
  assert.deepEqual(h.child.written, ["play\n", "pause\n"]);
});

test("during a long stall exactly one command is in the helper's input, whatever is sent and whatever old lines arrive", () => {
  const { h, r } = ready();
  for (let i = 0; i < 50; i++) {
    r.send(i % 2 === 0 ? "next" : "pause");
    h.child.emit(`${noSession(0)}\n${noSession(0)}\n`);
    h.advance(90);
  }
  assert.deepEqual(h.child.written, ["next\n"]);
  h.child.line(noSession(1));
  assert.deepEqual(h.child.written, ["next\n", "pause\n"], "then the newest one that waited, and only it");
  h.child.line(noSession(2));
  assert.equal(h.child.written.length, 2);
});
