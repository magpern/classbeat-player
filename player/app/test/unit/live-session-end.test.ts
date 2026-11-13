// A session the host is not in is ended on the backend (#203): End, the app quitting or another
// class while the start request is pending, connecting or reconnecting. Against the fake live
// process (test/unit/live-relay.ts): each case checks that a connection of the ender's own sent
// `hello` with the host token and then `end`, and that nothing else connects or is published.
// Fakes only: no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveSocketUrl } from "../../src/core/live/host-wire.ts";
import { END_TRIES_MS, END_TRY_MS, tryAgainAfter } from "../../src/main/live/ender.ts";
import { HOST_TOKEN, ORIGIN, OTHER_ORIGIN, rig, started } from "./live-relay.ts";
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

// #205: hardening of the ender.

test("a late answer after a re-pair is ended on the backend it came from, never on the new pairing's", async () => {
  const r = rig();
  r.live.start();
  r.live.classChanged();
  // The computer is paired again with another backend before the first answer comes.
  r.origin = OTHER_ORIGIN;
  r.live.start();
  await r.advance(0);
  assert.deepEqual(
    r.requests.map((q) => q.origin),
    [ORIGIN, OTHER_ORIGIN],
  );
  const [ender, host] = r.sockets;
  // The first session's host token goes only to the first backend.
  assert.equal(ender.url, liveSocketUrl(ORIGIN));
  assert.equal(host.url, liveSocketUrl(OTHER_ORIGIN));
  serveEnd(ender);
  host.open();
  host.server({ v: 1, type: "welcome", role: "host" });
  assert.equal(r.live.view().status, "On");
  await r.advance(0);
  assert.equal(r.sockets.length, 2);
});

test("the try's time limit is 10 s and the tries start at once, after 1 s and after 2 s", async () => {
  assert.equal(END_TRY_MS, 10_000);
  assert.deepEqual(END_TRIES_MS, [0, 1000, 2000]);
  const r = rig();
  r.live.start();
  r.live.end();
  await r.advance(0);
  r.socket().open();
  await r.advance(END_TRY_MS - 1);
  assert.equal(r.socket().closedByApp, false);
  await r.advance(1);
  assert.equal(r.socket().closedByApp, true);
});

test("end sent, then the connection drops with 1006: tried again, and the next hello finds the session gone", async () => {
  const r = rig();
  r.live.start();
  r.live.end();
  await r.advance(0);
  const first = r.socket();
  first.open();
  first.server({ v: 1, type: "welcome", role: "host" });
  assert.deepEqual(first.sent, [HELLO, END]);
  first.drop(1006);
  await r.advance(END_TRIES_MS[1] - 1);
  assert.equal(r.sockets.length, 1);
  await r.advance(1);
  assert.equal(r.sockets.length, 2);
  r.socket().open();
  assert.deepEqual(r.socket().sent, [HELLO]);
  r.socket().drop(4401);
  await quiet(r, 2);
});

test("end sent and no answer in time: tried again, and a session still there is ended then", async () => {
  const r = rig();
  r.live.start();
  r.live.end();
  await r.advance(0);
  const first = r.socket();
  first.open();
  first.server({ v: 1, type: "welcome", role: "host" });
  assert.deepEqual(first.sent, [HELLO, END]);
  await r.advance(END_TRY_MS);
  assert.equal(first.closedByApp, true);
  await r.advance(END_TRIES_MS[1]);
  assert.equal(r.sockets.length, 2);
  serveEnd(r.socket());
  await quiet(r, 2);
});

test("end sent and every connection drops with 1006: three tries at most", async () => {
  const r = rig();
  r.live.start();
  r.live.end();
  await r.advance(0);
  for (let n = 0; n < END_TRIES_MS.length; n += 1) {
    if (n > 0) await r.advance(END_TRIES_MS[n]);
    assert.equal(r.sockets.length, n + 1);
    const s = r.socket();
    s.open();
    s.server({ v: 1, type: "welcome", role: "host" });
    assert.deepEqual(s.sent, [HELLO, END]);
    s.drop(1006);
  }
  await quiet(r, END_TRIES_MS.length);
});

test("end sent and the connection closed cleanly: end arrived, so no other try", async () => {
  for (const code of [1000, 1001, 4403]) {
    const r = rig();
    r.live.start();
    r.live.end();
    await r.advance(0);
    r.socket().open();
    r.socket().server({ v: 1, type: "welcome", role: "host" });
    r.socket().drop(code);
    await quiet(r, 1);
  }
});

test("which closes are tried again", () => {
  const cases: readonly [number, boolean, boolean][] = [
    [1006, false, true],
    [1006, true, true],
    [1000, false, true],
    [1000, true, false],
    [1011, true, false],
    [4401, false, false],
    [4401, true, false],
    [4403, false, false],
    [4403, true, false],
    [4409, false, false],
    [4409, true, false],
  ];
  for (const [code, endSent, again] of cases) assert.equal(tryAgainAfter(code, endSent), again, `${code} ${endSent}`);
});
