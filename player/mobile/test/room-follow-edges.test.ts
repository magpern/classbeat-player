// Following on the phone's room screen at its edges (issue #884, docs/design/app-follow.md): Follow
// does nothing while the band offers no key; access that comes back from Android's setting after the
// class ended turns nothing on; and native code that stops following, or will not start it, for
// any reason but access or no media sessions hands the clock to the instructor, announced, instead
// of leaving it following a reader that asks nothing more. No phone, no network: native code is a
// script (room-follow-fakes.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LINK_CONFIG } from "../../app/src/core/link/types.ts";
import { flush, following, linkOf, opened, play, type Run } from "./room-follow-fakes.ts";

/** The class runs past its end (45 min) on the manual clock. */
async function ended(r: Run): Promise<void> {
  await r.room.start();
  r.h.tick(46 * 60_000);
  const f = await r.room.state();
  assert.equal(f.view?.status, "ended");
  assert.equal(f.followKey, false, "an ended class offers no Follow");
}

test("Follow without the band's key asks nothing: not while following, not once the class ended", async () => {
  const r = await following();
  assert.deepEqual(linkOf(await r.room.state()), ["following", "Manual", false]);
  const asked = r.native.calls.filter((c) => c === "followAccess").length;
  await r.room.follow();
  await r.wait(100);
  assert.equal(r.native.calls.filter((c) => c === "followAccess").length, asked, "no second access check while following");

  const e = await opened();
  await ended(e);
  await e.room.follow();
  await flush();
  assert.deepEqual(e.native.calls, [], "no access check, no sheet, nothing native");
  assert.equal(e.sheet(), null);
});

test("access given in the setting after the class ended: the sheet closes and nothing follows", async () => {
  const r = await opened();
  await r.room.follow();
  await flush();
  assert.equal(r.sheet(), "ask");
  r.openSetting();
  await ended(r);
  r.native.granted = true;
  r.back();
  await r.wait(1_000);
  assert.equal(r.sheet(), null);
  const f = await r.room.state();
  assert.equal(f.link?.mode, "manual");
  assert.equal(f.view?.status, "ended");
  assert.deepEqual(r.native.calls, ["followAccess", "openFollowSetting", "followAccess"], "never follow, never a reading");
});

test("native follow fails: the clock goes on by hand at once, announced, and Follow is offered again", async () => {
  const r = await opened();
  r.native.granted = true;
  r.native.followFails = true;
  await r.room.start();
  await r.room.follow();
  await r.wait(600);
  let f = await r.room.state();
  assert.equal(f.link?.mode, "manual", "not left following a reader that stopped");
  assert.notEqual(f.link?.announcement ?? null, null, "Following stopped");
  assert.equal(f.view?.status, "running");
  assert.equal(f.followKey, true);
  assert.deepEqual(r.native.calls, ["followAccess", "follow", "unfollow"], "no reading after the failed follow; native code is told to stop");

  // Follow again with native code answering: following goes on and stays on.
  r.native.followFails = false;
  await r.room.follow();
  await r.wait(1_000);
  f = await r.room.state();
  assert.equal(f.link?.mode, "following");
  assert.ok(r.native.calls.includes("reading"));
});

test("native code says it stopped following: Following stopped for 30 s, then the manual clock", async () => {
  const r = await following();
  await r.room.start();
  play(r, 1, 0);
  await r.wait(1_000);
  assert.equal((await r.room.state()).link?.state, "Locked");
  r.native.nativeStopped = true;
  await r.wait(600);
  let f = await r.room.state();
  assert.equal(f.link?.mode, "manual");
  assert.notEqual(f.link?.announcement ?? null, null, "Following stopped");
  assert.equal(f.view?.status, "running", "the clock goes on by hand at once");
  assert.equal(f.followKey, true);
  const readings = r.native.calls.filter((c) => c === "reading").length;
  await r.wait(DEFAULT_LINK_CONFIG.undoWindowMs + 1_000);
  f = await r.room.state();
  assert.deepEqual([...linkOf(f), f.link?.announcement ?? null], ["manual", "Manual", true, null]);
  assert.equal(r.native.calls.filter((c) => c === "reading").length, readings, "no reading once stopped");
});
