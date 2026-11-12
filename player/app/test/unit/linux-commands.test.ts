// Commands in the Linux reader are bounded: nothing before Spotify's first good answer, one in
// flight, one waiting. A fake execFile: nothing here starts a process.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LINUX_CALLS } from "../../src/core/link/linux-calls.ts";
import { createLinuxMusic } from "../../src/main/linux-reader.ts";
import type { ExecFileFn } from "../../src/main/linux-reader.ts";
import { bus, FAILED, names, PAUSED, PLAYING, STOPPED, VLC } from "./linux-bus.ts";

const COMMANDS = [LINUX_CALLS.play, LINUX_CALLS.pause, LINUX_CALLS.next] as readonly (readonly string[])[];

for (const [label, spotify, players] of [
  ["not running", FAILED, {}],
  ["answering garbage", "garbage", {}],
  ["not running while another player plays", FAILED, { [VLC]: PLAYING }],
] as const) {
  test(`no command is sent before Spotify's first good answer, and none goes late: Spotify ${label}`, () => {
    const b = bus({ spotify, players });
    b.linux.setActive(true);
    const sent = (): number => b.runs.filter((r) => COMMANDS.includes(r)).length;
    for (const action of ["play", "pause", "next"] as const) b.linux.send(action);
    assert.equal(sent(), 0);
    // The next read brings no good answer either: what waited is given up.
    b.poll();
    assert.equal(sent(), 0);
    b.state.spotify = PAUSED;
    b.poll();
    assert.equal(sent(), 0, "nothing held back is sent late");
    b.linux.send("play");
    assert.equal(b.runs.at(-1), LINUX_CALLS.play, "once Spotify has answered, a command goes at once");
  });
}

for (const [label, answer] of [
  ["playing", PLAYING],
  ["paused", PAUSED],
  ["with nothing loaded", STOPPED],
] as const) {
  test(`a command sent while the first read is under way waits, the newest only, and goes when Spotify answers ${label}`, () => {
    const runs: (readonly string[])[] = [];
    let answerRead: (out: string) => void = () => assert.fail("no read");
    const exec: ExecFileFn = (_file, args, _options, done) => {
      runs.push(args);
      if (args === LINUX_CALLS.read) answerRead = (out) => done(null, out);
      else if (args === LINUX_CALLS.names) done(null, names([]));
    };
    const linux = createLinuxMusic({ exec, now: () => 0, every: () => () => undefined });
    linux.setActive(true);
    for (const action of ["play", "next", "pause"] as const) linux.send(action);
    assert.deepEqual(runs, [LINUX_CALLS.read], "nothing before the first good answer");
    answerRead(answer);
    assert.deepEqual(runs.filter((r) => COMMANDS.includes(r)), [LINUX_CALLS.pause]);
  });
}

test("a command sent while Spotify has not answered at all stays unsent", () => {
  const b = bus({ spotify: null });
  b.linux.setActive(true);
  b.linux.send("play");
  assert.deepEqual(b.runs, [LINUX_CALLS.read], "Spotify has not answered: nothing is sent");
});

test("anything but the three names is refused by the reader itself", () => {
  const b = bus({ spotify: PLAYING });
  b.linux.setActive(true);
  const before = b.runs.length;
  for (const bad of ["read", "names", "Play", "previous", "", "toString", "__proto__", null, 5, ["play"]]) b.linux.send(bad as never);
  assert.equal(b.runs.length, before);
});

test("the gate closes again when following stops: following anew waits for a new first reading", () => {
  const b = bus({ spotify: PLAYING });
  b.linux.setActive(true);
  b.linux.send("pause");
  assert.equal(b.runs.at(-1), LINUX_CALLS.pause);
  b.linux.setActive(false);
  b.state.spotify = FAILED;
  b.linux.setActive(true);
  b.linux.send("play");
  b.poll();
  assert.equal(b.runs.filter((r) => r === LINUX_CALLS.play).length, 0);
});

test("at most one command in flight and one waiting, the newest replacing the one that waits", () => {
  const pending: (() => void)[] = [];
  const sent: string[] = [];
  const exec: ExecFileFn = (_file, args, _options, done) => {
    if (args === LINUX_CALLS.read) return done(null, PLAYING);
    sent.push(args.at(-1) ?? "");
    pending.push(() => done(null, ""));
  };
  const linux = createLinuxMusic({ exec, now: () => 0, every: () => () => undefined });
  linux.setActive(true);
  for (const action of ["pause", "next", "play", "next", "pause", "play"] as const) linux.send(action);
  assert.deepEqual(sent, ["Pause"], "one in flight");
  pending[0]();
  assert.deepEqual(sent, ["Pause", "Play"], "the newest of the five that waited, and only it");
  pending[1]();
  assert.deepEqual(sent, ["Pause", "Play"]);
  assert.equal(pending.length, 2);
});
