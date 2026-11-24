// The fake room the shell shows (issue #627): a web fixture, with no music app to command.
import assert from "node:assert/strict";
import { test } from "node:test";
import { REMOTE_ABSENT } from "../../app/src/core/room/remote.ts";
import { FIXTURE, fakeFrame, fakeRoom } from "../src/fake-room.ts";

test("the shown frame is the before-start fixture, on the class clock", () => {
  const f = fakeFrame() as unknown as { band: Record<string, string>; link: { available: boolean } | null };
  assert.equal(FIXTURE, "before-start");
  assert.deepEqual(Object.values(f.band), ["clock", "clock", "clock", "clock", "clock"]);
  if (f.link) assert.equal(f.link.available, false);
});

test("an unknown fixture is refused", () => {
  assert.throws(() => fakeFrame("no-such-fixture"));
});

test("every room command answers with the same frame and nothing else happens", async () => {
  const frame = fakeFrame();
  const room = fakeRoom(frame);
  for (const cmd of ["state", "start", "pause", "resume", "previous", "next", "forward", "back", "undo", "follow"] as const) {
    assert.equal(await room[cmd](), frame, cmd);
  }
  assert.equal(await room.endClass(), false);
  assert.equal(await room.remoteState(), REMOTE_ABSENT);
  assert.equal(await room.startRemote(), REMOTE_ABSENT);
});
