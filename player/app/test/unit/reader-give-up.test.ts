// Giving up without an answer (issue #51, item 6; #50 N2). A command that waits for the first
// good answer is given up when the read it waits for is given up, not only when that read
// answers badly: it never goes late. The same on macOS and Linux, which ask with one call per
// poll. (On Windows the helper is replaced when it goes quiet, and its commands go with it:
// test/unit/windows-reader.test.ts.) A fake execFile: no process is started.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GIVE_UP_MS as LINUX_GIVE_UP_MS } from "../../src/main/linux-reader.ts";
import { GIVE_UP_MS as MAC_GIVE_UP_MS } from "../../src/main/macos-reader.ts";
import { RIGS } from "./reader-rigs.ts";

test("a call is given up after twice its timeout", () => {
  assert.equal(MAC_GIVE_UP_MS, 1400);
  assert.equal(LINUX_GIVE_UP_MS, 1400);
});

for (const [system, make] of RIGS) {
  test(`${system}: a read that never answers is given up, and the command that waited for it with it`, () => {
    const r = make();
    r.reader.setActive(true);
    r.clock.t = 100;
    r.reader.send("next");
    // The polls go on; the first read is still in flight, so none joins it.
    for (r.clock.t = 250; r.clock.t < 1400; r.clock.t += 250) r.tick();
    assert.equal(r.count("read"), 1);
    assert.equal(r.count("next"), 0);

    r.clock.t = 1500;
    r.tick();
    assert.equal(r.count("read"), 2, "the first read was given up and a new one asked");
    r.last("read").ok(r.out.playing);
    assert.equal(r.reader.latest(1500)?.seenAt, 1500);
    assert.equal(r.count("next"), 0, "the command that waited for the lost read is not sent 1.4 s late");

    r.reader.send("pause");
    assert.equal(r.count("pause"), 1, "a command sent now goes at once");
  });

  test(`${system}: a command sent after the read was given up waits for the new read, and goes on its good answer`, () => {
    const r = make();
    r.reader.setActive(true);
    r.clock.t = 1400;
    r.tick();
    r.reader.send("next");
    assert.equal(r.count("next"), 0);
    r.calls[0].ok(r.out.playing);
    assert.equal(r.count("next"), 0, "the given-up read's late answer opens nothing");
    assert.equal(r.reader.latest(1400), null);
    r.last("read").ok(r.out.paused);
    assert.equal(r.count("next"), 1);
  });

  test(`${system}: once the music app has answered, a read that is given up later takes no command with it`, () => {
    const r = make();
    r.reader.setActive(true);
    r.last("read").ok(r.out.playing);
    r.reader.send("pause");
    r.reader.send("next");
    r.clock.t = 250;
    r.tick();
    r.clock.t = 250 + 1400;
    r.tick();
    assert.equal(r.count("read"), 3);
    r.last("pause").ok("");
    assert.equal(r.count("next"), 1, "the gate was open: the waiting command follows the one in flight");
  });
}
