// The phones' places on the presenter (#352; ADR 0005 section 10, amended 2026-11-14): what each
// `controller_left` reason shows, the replay after each host `welcome` rebuilding both places, and
// Drop offered only while a phone may come back. Through the real live client over the fake relay
// (live-relay.ts), from the wire frames to the presenter's view. Fakes only, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { placeOf } from "../../src/core/live/place-policy.ts";
import type { PlaceMessage } from "../../src/core/live/place-policy.ts";
import { started } from "./live-relay.ts";
import type { Rig } from "./live-relay.ts";

const slots = (r: Rig): [string, boolean][] => r.live.view().slots.map((s) => [s.text, s.canDrop]);
const drops = (r: Rig): unknown[] => r.socket().sent.filter((m) => (m as { type?: string }).type === "drop");

test("the place each message gives, whatever was shown before", () => {
  const table: [PlaceMessage, string][] = [
    [{ type: "controller_joined", slot: 1, via: "sign_in" }, "connected"],
    [{ type: "controller_joined", slot: 2, via: "code" }, "connected"],
    [{ type: "controller_left", slot: 1, via: "sign_in", reason: "disconnected" }, "away"],
    [{ type: "controller_left", slot: 1, via: "code", reason: "disconnected" }, "away"],
    [{ type: "controller_left", slot: 1, via: "sign_in", reason: "session_ended" }, "none"],
    [{ type: "controller_left", slot: 2, via: "sign_in", reason: "dropped" }, "none"],
    [{ type: "controller_left", slot: 2, via: "code", reason: "dropped" }, "none"],
    [{ type: "controller_left", slot: 2, reason: "free" }, "none"],
  ];
  for (const [msg, place] of table) assert.equal(placeOf(msg), place, JSON.stringify(msg));
});

test("a phone whose site session ended is shown free at once, with no Drop, connected or not (#352)", async () => {
  for (const connected of [true, false]) {
    const r = await started();
    r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "sign_in" });
    r.socket().server({ v: 1, type: "controller_joined", slot: 2, via: "sign_in" });
    if (!connected) r.socket().server({ v: 1, type: "controller_left", slot: 2, via: "sign_in", reason: "disconnected" });
    assert.deepEqual(slots(r)[1], [connected ? "Phone 2: steering" : "Phone 2: not connected", true]);
    r.socket().server({ v: 1, type: "controller_left", slot: 2, via: "sign_in", reason: "session_ended" });
    assert.deepEqual(slots(r), [
      ["Phone 1: steering", true],
      ["Phone 2: free", false],
    ]);
    // A Drop pressed on the freed place sends nothing.
    r.live.drop(2);
    assert.deepEqual(drops(r), []);
  }
});

test("a disconnected phone keeps its place as not connected with Drop; the host's drop and its answer free it", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  r.socket().server({ v: 1, type: "controller_left", slot: 1, via: "code", reason: "disconnected" });
  assert.deepEqual(slots(r)[0], ["Phone 1: not connected", true]);
  await r.advance(60_000);
  assert.deepEqual(slots(r)[0], ["Phone 1: not connected", true], "still held a minute later: the phone may come back");
  r.live.drop(1);
  assert.deepEqual(drops(r), [{ v: 1, type: "drop", slot: 1 }]);
  assert.deepEqual(slots(r)[0], ["Phone 1: free", false]);
  r.socket().server({ v: 1, type: "controller_left", slot: 1, via: "code", reason: "dropped" });
  assert.deepEqual(slots(r)[0], ["Phone 1: free", false]);
});

test("a dropped sent for a place the host did not drop here (another connection's drop) frees it too", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "controller_joined", slot: 2, via: "sign_in" });
  r.socket().server({ v: 1, type: "controller_left", slot: 2, via: "sign_in", reason: "dropped" });
  assert.deepEqual(slots(r)[1], ["Phone 2: free", false]);
});

test("after a reconnect the replay rebuilds both places: a phone that signed out meanwhile is free (#352)", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "sign_in" });
  r.socket().server({ v: 1, type: "controller_joined", slot: 2, via: "code" });
  r.socket().drop(1006);
  assert.deepEqual(slots(r), [
    ["Phone 1: not connected", false],
    ["Phone 2: not connected", false],
  ]);
  await r.advance(1000);
  r.socket().open();
  r.socket().server({ v: 1, type: "welcome", role: "host" });
  r.socket().server({ v: 1, type: "controller_left", slot: 1, reason: "free" });
  r.socket().server({ v: 1, type: "controller_left", slot: 2, via: "code", reason: "disconnected" });
  assert.deepEqual(slots(r), [
    ["Phone 1: free", false],
    ["Phone 2: not connected", true],
  ]);
  // The next reconnect: a phone signed in on place 1 while the host was away, place 2 was dropped.
  r.socket().drop(1006);
  await r.advance(1000);
  r.socket().open();
  r.socket().server({ v: 1, type: "welcome", role: "host" });
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "sign_in" });
  r.socket().server({ v: 1, type: "controller_left", slot: 2, reason: "free" });
  assert.deepEqual(slots(r), [
    ["Phone 1: steering", true],
    ["Phone 2: free", false],
  ]);
});

test("a controller_left without a reason, or with one the contract does not name, changes no place", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "sign_in" });
  for (const bad of [
    { v: 1, type: "controller_left", slot: 1, via: "sign_in" },
    { v: 1, type: "controller_left", slot: 1, via: "sign_in", reason: "gone" },
    { v: 1, type: "controller_left", slot: 1, via: "sign_in", reason: "free" },
    { v: 1, type: "controller_left", slot: 1, reason: "session_ended" },
  ]) {
    r.socket().server(bad);
    assert.deepEqual(slots(r)[0], ["Phone 1: steering", true], JSON.stringify(bad));
  }
});
