// One drop per press (#381; ADR 0005 section 3; core/live/drop-policy.ts): once the host sends
// `drop` for a place, Drop is not offered there and a press sends nothing until the server says the
// place is free (`controller_left` `dropped`, or `session_ended` or `free`), or a replay after a
// reconnect rebuilds it. A second press can so never drop a phone that took the place in between.
// The pure rule, then the live client over the fake live process. Fakes only, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dropSent, dropsLost, dropsWelcomed, mayDrop, NO_DROPS, placeTold } from "../../src/core/live/drop-policy.ts";
import type { Drops } from "../../src/core/live/drop-policy.ts";
import { livePanelView } from "../../src/core/live/panel-view.ts";
import { OFF } from "../../src/core/live/session-types.ts";
import type { LiveModel } from "../../src/core/live/session-types.ts";
import { started } from "./live-relay.ts";
import type { Rig } from "./live-relay.ts";

const drops = (r: Rig): unknown[] => r.socket().sent.filter((m) => (m as { type?: string }).type === "drop");
const place = (r: Rig, slot: 1 | 2): [string, boolean] => {
  const s = r.live.view().slots[slot - 1];
  return [s.text, s.canDrop];
};

test("the rule: sent until the server says the place is free; a lost one is queued, then sent again", () => {
  assert.ok(mayDrop(NO_DROPS, 1) && mayDrop(NO_DROPS, 2));
  const sent = dropSent(NO_DROPS, 1);
  assert.deepEqual(sent, ["sent", "none"]);
  assert.ok(!mayDrop(sent, 1));
  assert.ok(mayDrop(sent, 2), "the other place is not held up");
  // A phone shown in the place again (connected, or away) does not answer the drop.
  assert.deepEqual(placeTold(sent, 1, "connected"), sent);
  assert.deepEqual(placeTold(sent, 1, "away"), sent);
  assert.deepEqual(placeTold(sent, 1, "none"), NO_DROPS);
  assert.deepEqual(placeTold(sent, 2, "none"), sent, "only the place told of");
  const lost: Drops = dropsLost(sent, [1]);
  assert.deepEqual(lost, ["queued", "none"]);
  assert.ok(!mayDrop(lost, 1));
  assert.deepEqual(dropsWelcomed(lost), { drops: ["sent", "none"], resend: [1] });
  // A drop that went out before the loss is answered by the replay: nothing to send again.
  assert.deepEqual(dropsWelcomed(sent), { drops: NO_DROPS, resend: [] });
});

test("the presenter says a place with a drop waiting is dropping, with no Drop; free once freed", () => {
  const base = { ...OFF, phase: "live" as const, socket: 1, sockets: 1 };
  const facts = { now: 0, classOpen: true, secondDisplay: true, origin: null };
  const view = (m: LiveModel) => livePanelView(m, facts).slots.map((s) => [s.text, s.canDrop]);
  for (const p of ["connected", "away"] as const) {
    assert.deepEqual(view({ ...base, places: [p, "connected"], drops: ["sent", "none"] }), [["Phone 1: dropping", false], ["Phone 2: steering", true]], p);
    assert.deepEqual(view({ ...base, places: ["connected", p], drops: ["none", "queued"] }), [["Phone 1: steering", true], ["Phone 2: dropping", false]], p);
  }
  assert.deepEqual(view({ ...base, places: ["none", "none"], drops: ["sent", "none"] }), [["Phone 1: free", false], ["Phone 2: free", false]]);
});

test("Drop pressed twice before dropped sends one drop, even when the phone shows again in between", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  assert.deepEqual(place(r, 1), ["Phone 1: steering", true]);
  r.live.drop(1);
  assert.deepEqual(place(r, 1), ["Phone 1: free", false]);
  r.live.drop(1);
  // The phone's connection closes, and it comes back, before the server has the drop.
  r.socket().server({ v: 1, type: "controller_left", slot: 1, via: "code", reason: "disconnected" });
  assert.deepEqual(place(r, 1), ["Phone 1: dropping", false]);
  r.live.drop(1);
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  assert.deepEqual(place(r, 1), ["Phone 1: dropping", false]);
  r.live.drop(1);
  await r.advance(2000);
  assert.deepEqual(drops(r), [{ v: 1, type: "drop", slot: 1 }]);
  // The answer: the place is free, and the next phone in it can be dropped again.
  r.socket().server({ v: 1, type: "controller_left", slot: 1, via: "code", reason: "dropped" });
  assert.deepEqual(place(r, 1), ["Phone 1: free", false]);
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "sign_in" });
  assert.deepEqual(place(r, 1), ["Phone 1: steering", true]);
  r.live.drop(1);
  await r.advance(1000);
  assert.deepEqual(drops(r), [
    { v: 1, type: "drop", slot: 1 },
    { v: 1, type: "drop", slot: 1 },
  ]);
});

test("a drop waiting on one place leaves the other place's Drop as it was", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  r.socket().server({ v: 1, type: "controller_joined", slot: 2, via: "sign_in" });
  r.live.drop(1);
  assert.deepEqual(place(r, 2), ["Phone 2: steering", true]);
  r.live.drop(2);
  await r.advance(1000);
  assert.deepEqual(drops(r), [
    { v: 1, type: "drop", slot: 1 },
    { v: 1, type: "drop", slot: 2 },
  ]);
});

test("a site session's end frees the place and answers the drop too: the server has nothing left to drop", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "controller_joined", slot: 2, via: "sign_in" });
  r.live.drop(2);
  r.socket().server({ v: 1, type: "controller_left", slot: 2, via: "sign_in", reason: "session_ended" });
  r.socket().server({ v: 1, type: "controller_joined", slot: 2, via: "sign_in" });
  assert.deepEqual(place(r, 2), ["Phone 2: steering", true]);
});

test("Drop is offered again after a replay that names the place held", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  r.live.drop(1);
  assert.equal(drops(r).length, 1, "the drop went out on the first connection");
  r.socket().drop(1006);
  await r.advance(1000);
  r.socket().open();
  r.socket().server({ v: 1, type: "welcome", role: "host" });
  assert.deepEqual(drops(r), [], "not sent again on the new connection");
  // The replay: the server never had the drop, and the phone still holds the place.
  r.socket().server({ v: 1, type: "controller_left", slot: 1, via: "code", reason: "disconnected" });
  assert.deepEqual(place(r, 1), ["Phone 1: not connected", true]);
  r.live.drop(1);
  await r.advance(1000);
  assert.deepEqual(drops(r), [{ v: 1, type: "drop", slot: 1 }]);
});

test("a replay that names the place free leaves no Drop and nothing waiting", async () => {
  const r = await started();
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  r.live.drop(1);
  r.socket().drop(1006);
  await r.advance(1000);
  r.socket().open();
  r.socket().server({ v: 1, type: "welcome", role: "host" });
  r.socket().server({ v: 1, type: "controller_left", slot: 1, reason: "free" });
  assert.deepEqual(place(r, 1), ["Phone 1: free", false]);
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "sign_in" });
  assert.deepEqual(place(r, 1), ["Phone 1: steering", true]);
});
