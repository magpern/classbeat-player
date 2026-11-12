// Reading the server's answers strictly (core/pairing/protocol.ts), the server's address and the
// pairing page (origin.ts), and the saved record (record.ts), against the shapes of the backend's
// routes (backend/src/player_backend/player_api).
import assert from "node:assert/strict";
import { test } from "node:test";
import { pairingPageOn, parseBackendOrigin } from "../../src/core/pairing/origin.ts";
import { parseDeviceAnswer, parsePollAnswer, parseStartAnswer } from "../../src/core/pairing/protocol.ts";
import type { HttpAnswer } from "../../src/core/pairing/protocol.ts";
import { parseRecord, recordText } from "../../src/core/pairing/record.ts";
import { newToken, ORIGIN, PAGE, USER_CODE } from "./pairing-tokens.ts";

const http = (status: number, body: unknown, retryAfterS: number | null = null): HttpAnswer => ({ kind: "http", status, body, retryAfterS });

test("the server's address: HTTPS origins only; loopback HTTP only in development", () => {
  assert.deepEqual(parseBackendOrigin("https://player.example.test", false), { ok: true, origin: "https://player.example.test" });
  assert.deepEqual(parseBackendOrigin(" https://player.example.test:8443/ ", false), { ok: true, origin: "https://player.example.test:8443" });
  assert.deepEqual(parseBackendOrigin(undefined, true), { ok: false, reason: "unset" });
  assert.deepEqual(parseBackendOrigin("", true), { ok: false, reason: "unset" });
  for (const dev of ["http://127.0.0.1:8000", "http://localhost:8000", "http://[::1]:8000"]) {
    assert.equal(parseBackendOrigin(dev, true).ok, true, dev);
    assert.equal(parseBackendOrigin(dev, false).ok, false, `${dev} in a packaged build`);
  }
  for (const bad of ["http://player.example.test", "http://10.0.0.1", "https://u:p@player.example.test", "https://player.example.test/api", "https://player.example.test?x=1", "https://player.example.test#x", "file:///etc", "ftp://x.test", "not a url", "HTTPS://Player.Example.Test"]) {
    assert.equal(parseBackendOrigin(bad, true).ok, false, bad);
  }
});

test("the pairing page: on the server's own origin, with no query and no fragment", () => {
  assert.equal(pairingPageOn(ORIGIN, PAGE), PAGE);
  for (const bad of [`${PAGE}?code=BCDF-GHJK`, `${PAGE}#BCDF`, "https://evil.example.test/pair", "http://player.example.test/pair", "javascript:alert(1)", "file:///pair", 5, `${ORIGIN}/${"a".repeat(300)}`]) {
    assert.equal(pairingPageOn(ORIGIN, bad), null, String(bad));
  }
});

const startBody = (over: Record<string, unknown> = {}) => ({ device_code: newToken("dc"), user_code: USER_CODE, verification_uri: PAGE, expires_in: 600, interval: 5, ...over });

test("start: the backend's answer is read, and the interval is never under 5 s", () => {
  const body = startBody();
  assert.deepEqual(parseStartAnswer(http(200, body), ORIGIN), { kind: "started", deviceCode: body.device_code, userCode: USER_CODE, page: PAGE, expiresInMs: 600_000, intervalMs: 5000 });
  const fast = parseStartAnswer(http(200, startBody({ interval: 1 })), ORIGIN);
  assert.equal(fast.kind === "started" && fast.intervalMs, 5000);
  const slow = parseStartAnswer(http(200, startBody({ interval: 9 })), ORIGIN);
  assert.equal(slow.kind === "started" && slow.intervalMs, 9000);
});

test("start: refusals and anything malformed", () => {
  assert.deepEqual(parseStartAnswer({ kind: "unreachable" }, ORIGIN), { kind: "unreachable" });
  assert.deepEqual(parseStartAnswer(http(429, { error: "too_many_requests" }, 3600), ORIGIN), { kind: "too_many" });
  assert.deepEqual(parseStartAnswer(http(503, { error: "try_again" }), ORIGIN), { kind: "unreachable" });
  assert.deepEqual(parseStartAnswer(http(422, { error: "invalid_request" }), ORIGIN), { kind: "unexpected" });
  for (const over of [
    { device_code: newToken("dev") },
    { device_code: "cbp_dc_short" },
    { user_code: "AEIO-UAEI" },
    { user_code: "bcdf-ghjk" },
    { verification_uri: "https://evil.example.test/pair" },
    { verification_uri: `${PAGE}?user_code=BCDF-GHJK` },
    { expires_in: 0 },
    { expires_in: 5.5 },
    { interval: "5" },
    { interval: 0 },
  ]) {
    assert.deepEqual(parseStartAnswer(http(200, startBody(over)), ORIGIN), { kind: "unexpected" }, JSON.stringify(over));
  }
  for (const body of [null, [], "x", {}]) assert.deepEqual(parseStartAnswer(http(200, body), ORIGIN), { kind: "unexpected" });
});

test("poll: the four codes, the token, and retries", () => {
  for (const code of ["authorization_pending", "slow_down", "access_denied", "expired_token"]) assert.deepEqual(parsePollAnswer(http(400, { error: code })), { kind: code });
  assert.deepEqual(parsePollAnswer(http(400, { error: "other" })), { kind: "unexpected" });
  assert.deepEqual(parsePollAnswer(http(400, { error: "__proto__" })), { kind: "unexpected" });
  const token = newToken("dev");
  assert.deepEqual(parsePollAnswer(http(200, { device_token: token, email: "ann@example.test" })), { kind: "ok", token, email: "ann@example.test" });
  assert.deepEqual(parsePollAnswer(http(200, { device_token: newToken("dc"), email: "a@example.test" })), { kind: "unexpected" });
  assert.deepEqual(parsePollAnswer(http(200, { device_token: token })), { kind: "unexpected" });
  assert.deepEqual(parsePollAnswer({ kind: "unreachable" }), { kind: "retry", afterMs: null });
  assert.deepEqual(parsePollAnswer(http(429, {}, 20)), { kind: "retry", afterMs: 20_000 });
  assert.deepEqual(parsePollAnswer(http(500, undefined)), { kind: "retry", afterMs: null });
  assert.deepEqual(parsePollAnswer(http(302, undefined)), { kind: "unexpected" });
});

test("poll: control and bidi characters are taken out of the email before it is shown", () => {
  const token = newToken("dev");
  const r = parsePollAnswer(http(200, { device_token: token, email: "ann‮@exa\u0000mple.test " }));
  assert.deepEqual(r, { kind: "ok", token, email: "ann@example.test" });
});

test("device: its name, gone for good, expired, or not known", () => {
  assert.deepEqual(parseDeviceAnswer(http(200, { device: { name: "Studio", platform: "linux", version: "1", paired_at: "x" } })), { kind: "ok", name: "Studio" });
  assert.deepEqual(parseDeviceAnswer(http(401, { error: "token_revoked" })), { kind: "gone" });
  assert.deepEqual(parseDeviceAnswer(http(401, { error: "token_unknown" })), { kind: "gone" });
  assert.deepEqual(parseDeviceAnswer(http(401, { error: "token_expired" })), { kind: "expired" });
  // Never deleted on a network error, a server fault or an answer it does not know.
  for (const a of [{ kind: "unreachable" } as const, http(500, {}), http(429, {}), http(401, { error: "invalid_token" }), http(404, { error: "not_found" }), http(200, { device: {} })]) {
    assert.deepEqual(parseDeviceAnswer(a), { kind: "unknown" });
  }
});

test("record: written and read back; anything else is refused", () => {
  const r = { origin: ORIGIN, token: newToken("dev"), email: "a@example.test" };
  assert.deepEqual(parseRecord(recordText(r), false), r);
  assert.equal(parseRecord(recordText({ ...r, origin: "http://127.0.0.1:8000" }), false), null);
  assert.deepEqual(parseRecord(recordText({ ...r, origin: "http://127.0.0.1:8000" }), true), { ...r, origin: "http://127.0.0.1:8000" });
  for (const bad of ["", "{", "null", "[]", JSON.stringify({ v: 2, origin: ORIGIN, token: r.token, email: r.email }), recordText({ ...r, token: newToken("dc") }), recordText({ ...r, email: "" })]) {
    assert.equal(parseRecord(bad, true), null, bad);
  }
});
