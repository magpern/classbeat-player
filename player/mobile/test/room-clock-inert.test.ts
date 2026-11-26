// The phone's room has no live session and no mix (issue #901, from the review of #871): the
// callbacks the room screen may register for them are accepted and never called, however long the
// class runs and whatever the instructor does. No phone, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { openRoom } from "../src/room/open-room.ts";
import { classDoc, harness } from "./room-fakes.ts";

test("the remote and mix callbacks are accepted and never called", async () => {
  const h = harness(() => Promise.resolve({ document: classDoc() }));
  assert.equal(await openRoom(h.deps), "open");
  const room = h.installed[0];
  const heard: string[] = [];
  room.onRemote(() => void heard.push("remote"));
  room.onMix(() => void heard.push("mix"));
  room.onUpdate(() => {});
  await room.start();
  h.tick(10 * 60_000);
  await room.pause();
  await room.endClass();
  assert.deepEqual(heard, []);
});
