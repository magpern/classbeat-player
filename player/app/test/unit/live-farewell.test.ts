// Ending a live session on the host's own connection (#211; src/main/live/farewell.ts): `end` goes
// out within the send budget as the run's last message, the connection is kept until the live
// process answers, and an `end` that may not have arrived goes to the ender. Also: a step after
// the start answer that throws is logged without its text. Against the fake live process
// (test/unit/live-relay.ts) and its fake clock. Fakes only: no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { END_TRY_MS } from "../../src/main/live/ender.ts";
import { failedLine } from "../../src/main/live/live-service.ts";
import { HOST_TOKEN, rig, started } from "./live-relay.ts";

const HELLO = { v: 1, type: "hello", token: HOST_TOKEN };
const END = { v: 1, type: "end" };
const types = (sent: unknown[]): string[] => sent.map((m) => (m as { type: string }).type);

test("end waits for room in the send budget, and nothing is sent after it", async () => {
  const r = await started();
  const host = r.socket();
  // The state on welcome and six make_codes fill the second's 7 messages.
  for (let i = 0; i < 6; i++) r.live.makeCode();
  assert.equal(types(host.sent).filter((t) => t !== "hello").length, 7);
  r.live.end();
  assert.ok(!types(host.sent).includes("end"));
  assert.equal(r.live.busy(), true);
  await r.advance(1000);
  assert.deepEqual(host.sent[host.sent.length - 1], END);
  const at = host.sent.length;
  // A command or a new class state after the end is never sent or applied.
  r.controller.command({ type: "start" });
  r.live.tick();
  host.server({ v: 1, type: "command", slot: 1, id: "AAAAAAAAAAAAAAAAAAAAAQ", run: "AAAAAAAAAAAAAAAAAAAAAA", basis: 0, action: "pause" });
  await r.advance(3000);
  assert.equal(host.sent.length, at);
  assert.equal(r.controller.snapshot().view?.status, "running");
  host.drop(4403);
  await r.advance(0);
  assert.equal(r.live.busy(), false);
  assert.equal(r.sockets.length, 1);
});

test("a clean close after end means it arrived: no ender", async () => {
  const r = await started();
  r.live.end();
  r.socket().drop(1000);
  await r.advance(END_TRY_MS * 3);
  assert.equal(r.sockets.length, 1);
  assert.equal(r.live.busy(), false);
});

test("no answer in time: the host's connection is closed and the ender ends the session", async () => {
  const r = await started();
  const host = r.socket();
  r.live.end();
  await r.advance(END_TRY_MS - 1);
  assert.equal(host.closedByApp, false);
  await r.advance(1);
  assert.equal(host.closedByApp, true);
  assert.equal(r.sockets.length, 2);
  const s = r.socket();
  s.open();
  s.server({ v: 1, type: "welcome", role: "host" });
  assert.deepEqual(s.sent, [HELLO, END]);
  s.drop(4403);
  await r.advance(0);
  assert.equal(r.live.busy(), false);
});

test("the host's connection dropping with 1006 after end goes to the ender; a 4401 then ends it", async () => {
  const r = await started();
  r.live.stop();
  r.socket().drop(1006);
  assert.equal(r.sockets.length, 2);
  r.socket().open();
  r.socket().drop(4401);
  await r.advance(0);
  assert.equal(r.live.busy(), false);
  await r.advance(120_000);
  assert.equal(r.sockets.length, 2);
});

test("a new session can start while the old one's end is still waiting for its answer", async () => {
  const r = await started();
  const old = r.socket();
  r.live.end();
  await started(r);
  assert.equal(r.live.view().status, "On");
  // The old connection's answer ends only the old one.
  old.server({ v: 1, type: "ended", reason: "host_ended" });
  assert.equal(old.closedByApp, true);
  assert.equal(r.live.view().status, "On");
  assert.equal(r.socket().closedByApp, false);
});

test("a step after the start answer that throws is logged once, without its text", async () => {
  const r = rig();
  r.connectThrows = new Error(`connect failed for ${HOST_TOKEN}`);
  r.live.start();
  await r.advance(0);
  assert.equal(r.live.busy(), false);
  assert.deepEqual(r.logs, ["live session: a step after a backend answer failed (Error)"]);
  assert.ok(!r.logs.join("\n").includes(HOST_TOKEN));
  // Only a plain name is kept; anything else is "error".
  const odd = new TypeError("x");
  odd.name = HOST_TOKEN;
  assert.equal(failedLine(odd), "live session: a step after a backend answer failed (error)");
  assert.equal(failedLine(HOST_TOKEN), "live session: a step after a backend answer failed (error)");
  assert.equal(failedLine(new TypeError(HOST_TOKEN)), "live session: a step after a backend answer failed (TypeError)");
});
