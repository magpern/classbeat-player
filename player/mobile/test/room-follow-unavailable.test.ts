// followAccess answering {granted: false, state: "unavailable"} at the press (issue #899, ADR 0016
// section 5): the second line of defence after reader-platform.ts. Follow is hidden, no sheet. The phone's follower
// is the app's own reader and ask over a scripted native side (room-follow-fakes.ts); no phone,
// no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAndroidReader } from "../src/follow/android-reader.ts";
import { createFollowAsk } from "../src/room/follow-ask.ts";
import type { SheetKind } from "../src/room/follow-ask.ts";
import type { RoomFollower } from "../src/room/clock-room.ts";
import { hasMusicReader } from "../src/room/reader-platform.ts";
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
    press: (on, none) => ask.press(on, none),
  });
  assert.equal(await openRoom({ ...h.deps, follower }), "open");
  return { h, native, room: h.installed[0], sheet: () => shown };
}

test("Follow pressed, followAccess says no reader: no sheet, Follow hidden, follow never called, manual controls work", async () => {
  const r = await openedOn("unavailable");
  assert.equal((await r.room.state()).followKey, true, "nothing is known before the press");
  await r.room.follow();
  await flush();
  assert.equal(r.sheet(), null);
  assert.deepEqual(linkOf(await r.room.state()), ["manual", "Manual", false]);
  await r.room.follow();
  await flush();
  assert.deepEqual(r.native.calls, ["followAccess"], "asked once, then Follow is gone");
  await r.room.start();
  r.h.tick(5_000);
  const f = await r.room.state();
  assert.equal(f.view?.status, "running");
  assert.equal(f.view?.classMs, 5_000);
  await r.room.pause();
  assert.equal((await r.room.state()).view?.status, "paused");
  assert.equal((await r.room.state()).followKey, false);
});

test("no reader (iOS): no Follow key from the first frame, no follower built and nothing native is asked", async () => {
  const h = harness(() => Promise.resolve({ document: classDoc() }));
  let built = 0;
  const follower = (): RoomFollower => {
    built++;
    throw new Error("a follower is never built where there is no reader");
  };
  assert.equal(await openRoom({ ...h.deps, follower, hasReader: hasMusicReader("ios") }), "open");
  assert.equal(built, 0);
  assert.equal((await h.installed[0].state()).followKey, false);
  await h.installed[0].follow();
  assert.equal((await h.installed[0].state()).followKey, false);
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
