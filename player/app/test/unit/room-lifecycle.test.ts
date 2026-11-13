// When the room screen's window closes, and when "Show the room screen" opens it again
// (core/room/lifecycle.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { roomCloses, roomMayOpen } from "../../src/core/room/lifecycle.ts";

test("the room window closes on the class list once no class is pinned, and only then", () => {
  assert.equal(roomCloses(true, false), true);
  assert.equal(roomCloses(true, true), false, "Back to the class is still offered");
  assert.equal(roomCloses(false, false), false, "the presenter shows the class, ended or not");
  assert.equal(roomCloses(false, true), false);
});

test("Show the room screen opens it while a class is open and not closed", () => {
  assert.equal(roomMayOpen(true, false, false), true, "a class from a file, on the presenter");
  assert.equal(roomMayOpen(true, false, true), true, "a pinned class, on the presenter");
  assert.equal(roomMayOpen(true, true, true), true, "on the list, the pinned class can be gone back to");
  assert.equal(roomMayOpen(true, true, false), false, "on the list with nothing pinned: the class is closed");
  for (const onList of [true, false]) for (const pinned of [true, false]) assert.equal(roomMayOpen(false, onList, pinned), false, "no class open");
});
