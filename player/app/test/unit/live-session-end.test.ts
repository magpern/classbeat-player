// A session the host is not in is ended on the backend (#203): End, the app quitting or another
// class while the start request is pending, connecting or reconnecting. Against the fake live
// process (test/unit/live-relay.ts): each case checks that a connection of the ender's own sent
// `hello` with the host token and then `end`, and that nothing else connects or is published.
// Fakes only: no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { END_TRIES_MS, END_TRY_MS } from "../../src/main/live/ender.ts";
import { HOST_TOKEN, rig, started } from "./live-relay.ts";
import type { FakeSocket, Rig } from "./live-relay.ts";

const HELLO = { v: 1, type: "hello", token: HOST_TOKEN };
const END = { v: 1, type: "end" };

/** The fake server welcomes the ender's connection and closes it with 4403 once `end` came. */
function serveEnd(s: FakeSocket): void {
  s.open();
  assert.deepEqual(s.sent, [HELLO]);
  s.server({ v: 1, type: "welcome", role: "host" });
  assert.deepEqual(s.sent, [HELLO, END]);
  s.drop(4403);
}

/** After the session was ended: nothing more connects, even after the reconnect back-off. */
async function quiet(r: Rig, sockets: number): Promise<void> {
  await r.advance(120_000);
  assert.equal(r.sockets.length, sockets);
}

for (const [name, ending] of [
  ["End", (r: Rig) => void r.live.end()],
  ["stop (the app quits)", (r: Rig) => r.live.stop()],
  ["another class", (r: Rig) => r.live.classChanged()],
] as const) {
  test(`${name} while starting: the answer's session is ended on the backend and nothing connects for the host`, async () => {
    const r = rig();
    r.live.start();
    assert.equal(r.live.view().status, "Starting…");
    assert.equal(r.live.view().canEnd, true);
    ending(r);
    assert.equal(r.live.view().status, "Ended");
    await r.advance(0);
    assert.equal(r.requests.length, 1);
    // The one socket is the ender's: hello, end and nothing else.
    assert.equal(r.sockets.length, 1);
    serveEnd(r.socket());
    assert.equal(r.live.view().status, "Ended");
    assert.equal(r.live.view().classCode, null);
    await quiet(r, 1);
    assert.deepEqual(r.sockets[0].sent, [HELLO, END]);
  });

  test(`${name} while connecting: the connection is closed and the session ended on one of its own`, async () => {
    const r = rig();
    r.live.start();
    await r.advance(0);
    const host = r.socket();
    host.open();
    assert.deepEqual(host.sent, [HELLO]);
    ending(r);
    assert.equal(host.closedByApp, true);
    assert.equal(r.sockets.length, 2);
    serveEnd(r.socket());
    await quiet(r, 2);
    assert.deepEqual(host.sent, [HELLO]);
  });

  test(`${name} while reconnecting: the retry is cancelled and the session ended`, async () => {
    const r = await started();
    r.socket().drop(1006);
    assert.equal(r.live.view().status, "Reconnecting");
    ending(r);
    assert.equal(r.sockets.length, 2);
    serveEnd(r.socket());
    await quiet(r, 2);
  });
}

test("a late answer after another class opened and a new start: the old session is ended, the new one runs", async () => {
  const r = rig();
  r.live.start();
  r.live.classChanged();
  r.live.start();
  await r.advance(0);
  assert.equal(r.requests.length, 2);
  // The first answer ended, the second connected for the host.
  const [ender, host] = r.sockets;
  serveEnd(ender);
  host.open();
  host.server({ v: 1, type: "welcome", role: "host" });
  assert.equal(r.live.view().status, "On");
  assert.ok(!host.sent.some((m) => (m as { type?: string }).type === "end"));
});

test("the ender tries again when the backend cannot be reached, three times at most", async () => {
  const r = await started();
  r.socket().drop(1006);
  r.live.end();
  assert.equal(r.sockets.length, 2);
  r.socket().drop(1006);
  await r.advance(END_TRIES_MS[1]);
  assert.equal(r.sockets.length, 3);
  // A try with no answer gives up on its connection after END_TRY_MS.
  await r.advance(END_TRY_MS);
  assert.equal(r.socket().closedByApp, true);
  await r.advance(END_TRIES_MS[2]);
  assert.equal(r.sockets.length, 4);
  r.socket().drop(1006);
  await quiet(r, 4);
  for (const s of r.sockets.slice(1)) assert.ok(s.sent.every((m) => (m as { type?: string }).type !== "companion_state"));
});

test("the ender stops when the session is already gone, and sends the token only in hello", async () => {
  const r = rig();
  r.live.start();
  r.live.end();
  await r.advance(0);
  r.socket().open();
  r.socket().drop(4401);
  await quiet(r, 1);
  assert.deepEqual(r.socket().sent, [HELLO]);
  assert.ok(!JSON.stringify(r.live.view()).includes(HOST_TOKEN));
});
