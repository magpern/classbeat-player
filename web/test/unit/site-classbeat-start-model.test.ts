// Confirming it is you with classbeat (src/site/core/classbeat-start-model.ts; ADR 0010, sections 2,
// 5 and 6): the start's body carries no return entry, which authorize addresses the page goes to,
// and what each answer of the start means.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { afterErrorCheck, afterReauthStart, afterSignInStart, authorizeOf, isClassbeatError, NOT_CONFIRMED_WORDS, REAUTH_BODY, SIGN_IN_BODY } from "../../src/site/core/classbeat-start-model.ts";
import { impurities } from "../lib/core-purity.ts";

const AUTHORIZE = "https://classbeat.test/oauth/authorize?response_type=code&client_id=player&state=s&prompt=login";

describe("the start's body", () => {
  it("is the purpose only: no return entry (ADR 0010, section 6)", () => {
    assert.deepEqual(REAUTH_BODY, { purpose: "reauth" });
    assert.ok(!("return_to" in REAUTH_BODY));
  });
});

describe("the authorize address", () => {
  it("is HTTPS, or HTTP on this computer", () => {
    assert.equal(authorizeOf({ authorize: AUTHORIZE }), AUTHORIZE);
    assert.equal(authorizeOf({ authorize: "http://127.0.0.1:9000/authorize?x=1" }), "http://127.0.0.1:9000/authorize?x=1");
    assert.equal(authorizeOf({ authorize: "http://localhost:9000/authorize" }), "http://localhost:9000/authorize");
  });

  it("is refused otherwise", () => {
    for (const bad of [
      "http://classbeat.test/authorize",
      "javascript:alert(1)",
      "data:text/html,x",
      "/sign-in",
      "https://user:pw@classbeat.test/authorize",
      "https://classbeat.test\\@evil.test/authorize",
      "https://classbeat.test/authorize?a=b c",
      `https://classbeat.test/${"a".repeat(4000)}`,
      "",
    ]) assert.equal(authorizeOf({ authorize: bad }), null, bad);
    for (const body of [null, {}, { authorize: 1 }, "https://classbeat.test/", []]) assert.equal(authorizeOf(body), null, JSON.stringify(body));
  });
});

describe("after the start", () => {
  it("goes to classbeat, ends the session, or shows a plate", () => {
    assert.deepEqual(afterReauthStart({ kind: "ok", status: 200, body: { authorize: AUTHORIZE } }), { kind: "go", to: AUTHORIZE });
    assert.deepEqual(afterReauthStart({ kind: "ok", status: 200, body: { authorize: "http://evil.test/" } }), { kind: "plate", plate: { kind: "server" } });
    assert.deepEqual(afterReauthStart({ kind: "not_signed_in" }), { kind: "ended" });
    assert.deepEqual(afterReauthStart({ kind: "too_many", retryAfter: 60 }), { kind: "plate", plate: { kind: "too-many", retryAfter: 60 } });
    assert.deepEqual(afterReauthStart({ kind: "offline" }), { kind: "plate", plate: { kind: "offline" } });
    assert.deepEqual(afterReauthStart({ kind: "refused", status: 404, code: "not_found" }), { kind: "plate", plate: { kind: "server" } });
    assert.deepEqual(afterReauthStart({ kind: "refused", status: 422, code: "invalid_return" }), { kind: "plate", plate: { kind: "server" } });
    assert.deepEqual(afterReauthStart({ kind: "server" }), { kind: "plate", plate: { kind: "server" } });
  });
});

describe("signing in with classbeat (#511)", () => {
  it("sends the purpose only: sign_in, no return entry", () => {
    assert.equal(JSON.stringify(SIGN_IN_BODY), '{"purpose":"sign_in"}');
  });

  it("goes to classbeat, or shows a plate, never 'ended' (no session is asked for)", () => {
    assert.deepEqual(afterSignInStart({ kind: "ok", status: 200, body: { authorize: AUTHORIZE } }), { kind: "go", to: AUTHORIZE });
    assert.deepEqual(afterSignInStart({ kind: "ok", status: 200, body: { authorize: "javascript:alert(1)" } }), { kind: "plate", plate: { kind: "server" } });
    assert.deepEqual(afterSignInStart({ kind: "too_many", retryAfter: 480 }), { kind: "plate", plate: { kind: "classbeat-limited", retryAfter: 480 } });
    assert.deepEqual(afterSignInStart({ kind: "offline" }), { kind: "plate", plate: { kind: "offline" } });
    assert.deepEqual(afterSignInStart({ kind: "not_signed_in" }), { kind: "plate", plate: { kind: "server" } });
    assert.deepEqual(afterSignInStart({ kind: "refused", status: 422, code: "invalid_purpose" }), { kind: "plate", plate: { kind: "server" } });
    assert.deepEqual(afterSignInStart({ kind: "server" }), { kind: "plate", plate: { kind: "server" } });
  });
});

describe("#error=classbeat", () => {
  it("is read only as that exact fragment", () => {
    assert.equal(isClassbeatError("#error=classbeat"), true);
    for (const other of ["", "#", "#error=classbeatx", "#error=CLASSBEAT", "#error=other", "#error=classbeat&x", "#error=classbeat ", "#x&error=classbeat", "error=classbeat"]) {
      assert.equal(isClassbeatError(other), false, other);
    }
  });

  it("asks GET me: 401 did not finish, 200 still signed in, anything else a failed check", () => {
    assert.deepEqual(afterErrorCheck({ kind: "not_signed_in" }), { kind: "unfinished" });
    assert.deepEqual(afterErrorCheck({ kind: "ok", status: 200, body: {} }), { kind: "still-signed-in" });
    assert.deepEqual(afterErrorCheck({ kind: "too_many", retryAfter: 300 }), { kind: "failed", why: "too-many", retryAfter: 300 });
    assert.deepEqual(afterErrorCheck({ kind: "offline" }), { kind: "failed", why: "offline" });
    assert.deepEqual(afterErrorCheck({ kind: "server" }), { kind: "failed", why: "server" });
    assert.deepEqual(afterErrorCheck({ kind: "refused", status: 404, code: "not_found" }), { kind: "failed", why: "server" });
  });

  it("still signed in, it offers only a re-authentication, whose body is reauth", () => {
    assert.equal(JSON.stringify(REAUTH_BODY), '{"purpose":"reauth"}');
    assert.equal(NOT_CONFIRMED_WORDS.head, "classbeat did not confirm it is you");
    assert.match(NOT_CONFIRMED_WORDS.detail, /You are still signed in here, and nothing was changed\./);
  });
});

describe("purity", () => {
  it("imports no I/O", () => {
    const path = fileURLToPath(new URL("../../src/site/core/classbeat-start-model.ts", import.meta.url));
    assert.deepEqual(impurities(path, readFileSync(path, "utf8")), []);
  });
});
