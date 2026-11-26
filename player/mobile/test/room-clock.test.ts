// The phone's `window.room` drives the shared class clock (issue #871): the room screen's manual
// controls through the same calls the desktop serves, on fake time. Follow stays unavailable.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoomFrame } from "../../app/src/core/room/frame.ts";
import { REMOTE_ABSENT } from "../../app/src/core/room/remote.ts";
import { PUSH_EVERY_MS } from "../src/room/clock-room.ts";
import type { ClockRoom } from "../src/room/clock-room.ts";
import { openRoom } from "../src/room/open-room.ts";
import { classDoc, harness, type Harness } from "./room-fakes.ts";

async function opened(): Promise<{ h: Harness; room: ClockRoom }> {
  const h = harness(() => Promise.resolve({ document: classDoc() }));
  assert.equal(await openRoom(h.deps), "open");
  return { h, room: h.installed[0] };
}

const at = (f: RoomFrame): [string | undefined, number | undefined, number | undefined] => [f.view?.status, f.view?.classMs, f.view?.intervalIndex];

test("Start, Pause and Resume run and hold the class clock", async () => {
  const { h, room } = await opened();
  assert.deepEqual(at(await room.start()), ["running", 0, 0]);
  h.tick(12_000);
  assert.deepEqual(at(await room.state()), ["running", 12_000, 0]);
  assert.deepEqual(at(await room.pause()), ["paused", 12_000, 0]);
  h.tick(30_000);
  assert.deepEqual(at(await room.state()), ["paused", 12_000, 0]);
  assert.deepEqual(at(await room.resume()), ["running", 12_000, 0]);
  h.tick(1_000);
  assert.equal((await room.state()).view?.classMs, 13_000);
});

test("Forward and Back move five seconds; Next and Previous move by interval", async () => {
  const { h, room } = await opened();
  await room.start();
  h.tick(20_000);
  assert.equal((await room.forward()).view?.classMs, 25_000);
  assert.equal((await room.back()).view?.classMs, 20_000);
  const next = await room.next();
  assert.equal(next.view?.intervalIndex, 1);
  const secondStart = next.view!.classMs;
  assert.ok(secondStart > 20_000);
  // Previous right after a change goes to the interval before; once into an interval, to its start.
  assert.deepEqual(at(await room.previous()), ["running", 0, 0]);
  await room.next();
  h.tick(10_000);
  assert.equal((await room.previous()).view?.classMs, secondStart);
});

test("Undo and Follow leave the manual clock as it is: there is no music to follow", async () => {
  const { h, room } = await opened();
  await room.start();
  h.tick(5_000);
  const before = await room.state();
  for (const f of [await room.undo(), await room.follow()]) {
    assert.deepEqual(at(f), at(before));
    assert.equal(f.link?.available, false);
    assert.equal(f.link?.mode, "manual");
  }
});

test("the room screen is sent a frame every 100 ms, on the clock it drives", async () => {
  const { h, room } = await opened();
  const got: RoomFrame[] = [];
  room.onUpdate((f) => got.push(f));
  h.tick(PUSH_EVERY_MS * 3);
  assert.equal(got.length, 3);
  assert.deepEqual(got.map((f) => f.view?.status), ["ready", "ready", "ready"]);
  await room.start();
  h.tick(PUSH_EVERY_MS * 2);
  assert.deepEqual(got.slice(3).map((f) => f.view?.classMs), [100, 200]);
  // A second listener shares the one timer.
  room.onUpdate(() => {});
  h.tick(PUSH_EVERY_MS);
  assert.equal(got.length, 6);
});

test("End goes back to the class list; there is no live session and no mix", async () => {
  const { h, room } = await opened();
  assert.equal(await room.endClass(), true);
  assert.equal(h.left, 1);
  assert.equal(await room.remoteState(), REMOTE_ABSENT);
  assert.equal(await room.startRemote(), REMOTE_ABSENT);
  assert.equal(await room.mixReport(), null);
});
