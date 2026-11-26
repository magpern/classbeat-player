// A platform with no music reader (ADR 0016, section 5; issue #899): followAccess answers
// {granted: false, state: "unavailable"} and the room never offers Follow. The phone's follower
// is the app's own reader and ask over a scripted native side (room-follow-fakes.ts); no phone,
// no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAndroidReader } from "../src/follow/android-reader.ts";
import { parseAccessUnavailable } from "../src/follow/answers.ts";
import { createFollowAsk } from "../src/room/follow-ask.ts";
import type { SheetKind } from "../src/room/follow-ask.ts";
import type { RoomFollower } from "../src/room/clock-room.ts";
import { openRoom } from "../src/room/open-room.ts";
import { fakeNative, flush, linkOf } from "./room-follow-fakes.ts";
import { classDoc, harness } from "./room-fakes.ts";

type Access = "unavailable" | "denied" | "granted";

/** The room opened over phone-follower.ts's wiring, with followAccess answering [access]. */
async function openedOn(access: Access, follow: "unavailable" | "following" | "noAccess" = "following") {
  const h = harness(() => Promise.resolve({ document: classDoc() }));
  const native = fakeNative(() => h.deps.now());
  native.followAccess = async () => (
    native.calls.push("followAccess"),
    access === "unavailable" ? { granted: false, state: "unavailable" } : { granted: access === "granted" }
  );
  native.follow = async () => (native.calls.push("follow"), { state: follow });
  let shown: SheetKind | null = null;
  const ask = createFollowAsk({
    access: () => native.followAccess(),
    openSetting: () => native.openFollowSetting(),
    sheet: { show: (k) => void (shown = k), hide: () => void (shown = null), isOpen: () => shown !== null },
    onReturn: () => {},
  });
  const follower = (): RoomFollower => ({
    reader: createAndroidReader(native, h.deps),
    press: (on) => ask.press(on),
    noReader: () => native.followAccess().then(parseAccessUnavailable, () => false),
  });
  assert.equal(await openRoom({ ...h.deps, follower }), "open");
  await flush();
  return { h, native, room: h.installed[0], sheet: () => shown };
}

test("no reader: no Follow key from the first frame, no sheet, follow never called, manual controls work", async () => {
  const r = await openedOn("unavailable");
  assert.deepEqual(linkOf(await r.room.state()), ["manual", "Manual", false]);
  await r.room.follow();
  await flush();
  assert.equal(r.sheet(), null);
  assert.ok(!r.native.calls.includes("follow"), "follow is never called");
  assert.deepEqual(r.native.calls, ["followAccess"], "one read-only question as the room opens, nothing else");
  await r.room.start();
  r.h.tick(5_000);
  const f = await r.room.state();
  assert.equal(f.view?.status, "running");
  assert.equal(f.view?.classMs, 5_000);
  await r.room.pause();
  assert.equal((await r.room.state()).view?.status, "paused");
  assert.equal((await r.room.state()).followKey, false);
  assert.deepEqual(r.native.calls, ["followAccess"]);
});

test("a platform that answers access as before keeps Follow: granted and refused", async () => {
  for (const access of ["granted", "denied"] as const) {
    const r = await openedOn(access);
    assert.equal((await r.room.state()).followKey, true, access);
  }
});

test("follow answering unavailable still hides Follow, as before", async () => {
  const r = await openedOn("granted", "unavailable");
  assert.equal((await r.room.state()).followKey, true);
  await r.room.follow();
  await flush();
  r.h.tick(500);
  await flush();
  const f = await r.room.state();
  assert.deepEqual(linkOf(f), ["manual", "Manual", false]);
  assert.equal(r.sheet(), null);
});
