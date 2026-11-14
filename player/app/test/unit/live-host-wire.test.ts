// The host's reading of the live process (core/live/host-wire.ts) against the contract's own
// examples: every valid example of a message routed to the host is taken, every invalid one is
// dropped, and the start answer maps each refusal. Fakes only.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { liveSocketUrl, parseHostFrame, parseHostMessage, parseStartAnswer } from "../../src/core/live/host-wire.ts";
import { LIVE_V1 } from "./live-rig.ts";

const SECRET = randomBytes(32).toString("base64url");
const examples = (name: string, kind: "valid" | "invalid"): [string, unknown][] => {
  const dir = join(LIVE_V1, "examples", name, kind);
  return readdirSync(dir).map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8").replaceAll("<secret43>", SECRET))]);
};

const TO_HOST = ["controller-joined", "controller-left", "control-code", "code-cancelled", "ended", "rider-joined", "rider-left", "lock-state", "join-code"];

test("every valid example of a message to the host is taken, as its own type", () => {
  for (const name of TO_HOST) {
    for (const [file, ex] of examples(name, "valid")) {
      const m = parseHostMessage(ex);
      assert.ok(m !== null, `${name}/${file}`);
      assert.equal(m.type, (ex as { type: string }).type);
    }
  }
});

test("every invalid example of a message to the host is dropped", () => {
  for (const name of TO_HOST) {
    for (const [file, ex] of examples(name, "invalid")) assert.equal(parseHostMessage(ex), null, `${name}/${file}`);
  }
});

test("welcome: only the host's own, with nothing but its role", () => {
  for (const [file, ex] of examples("welcome", "valid")) {
    const host = (ex as { role: string }).role === "host";
    assert.equal(parseHostMessage(ex) !== null, host, file);
  }
  for (const [file, ex] of examples("welcome", "invalid")) assert.equal(parseHostMessage(ex), null, file);
});

test("messages the host is never sent are dropped: companion_state, ack, host_status, hello", () => {
  for (const name of ["companion-state", "ack", "host-status", "hello", "make-code", "drop", "end", "rider-state", "drop-rider", "lock", "new-join-code", "join-request", "welcome-rider"]) {
    for (const [file, ex] of examples(name, "valid")) assert.equal(parseHostMessage(ex), null, `${name}/${file}`);
  }
});

test("a forwarded command is passed on untouched for the intake to check", () => {
  const raw = { v: 1, type: "command", slot: 1, id: "x", run: "y", basis: 0, action: "pause" };
  assert.deepEqual(parseHostMessage(raw), { type: "command", raw });
});

test("frames: not JSON, not an object, the wrong version or too big are dropped", () => {
  assert.equal(parseHostFrame("not json"), null);
  assert.equal(parseHostFrame("[1]"), null);
  assert.equal(parseHostFrame(JSON.stringify({ v: 2, type: "ended", reason: "expired" })), null);
  assert.equal(parseHostFrame(JSON.stringify({ v: 1, type: "ended", reason: "expired", pad: "x".repeat(70_000) })), null);
  assert.deepEqual(parseHostFrame(JSON.stringify({ v: 1, type: "ended", reason: "expired" })), { type: "ended", reason: "expired" });
});

test("the start answer: the session from a good 200, each refusal by its status", () => {
  const [[, good]] = examples("session-answer", "valid");
  const ok = parseStartAnswer({ kind: "http", status: 200, body: good, retryAfterS: null });
  assert.equal(ok.ok, true);
  for (const [file, bad] of examples("session-answer", "invalid")) assert.deepEqual(parseStartAnswer({ kind: "http", status: 200, body: bad, retryAfterS: null }), { ok: false, refusal: "server" }, file);
  const refused = (status: number, error?: string) => parseStartAnswer({ kind: "http", status, body: error === undefined ? undefined : { error }, retryAfterS: null });
  assert.deepEqual(refused(401, "token_revoked"), { ok: false, refusal: "pair_again" });
  assert.deepEqual(refused(409, "sessions_full"), { ok: false, refusal: "sessions_full" });
  assert.deepEqual(refused(429, "too_many_requests"), { ok: false, refusal: "too_many" });
  assert.deepEqual(refused(500, "internal_error"), { ok: false, refusal: "server" });
  assert.deepEqual(parseStartAnswer({ kind: "unreachable" }), { ok: false, refusal: "unreachable" });
});

test("the socket address: wss on https, ws on loopback http, never a token in it", () => {
  assert.equal(liveSocketUrl("https://player.example.test"), "wss://player.example.test/api/live/ws");
  assert.equal(liveSocketUrl("http://127.0.0.1:8123"), "ws://127.0.0.1:8123/api/live/ws");
});
