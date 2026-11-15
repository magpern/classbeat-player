// Confirming it is you with classbeat (src/site/core/classbeat-start-model.ts; ADR 0010, sections 2,
// 5 and 6): the start's body carries no return entry, which authorize addresses the page goes to,
// and what each answer of the start means.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { afterReauthStart, authorizeOf, REAUTH_BODY } from "../../src/site/core/classbeat-start-model.ts";
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

describe("purity", () => {
  it("imports no I/O", () => {
    const path = fileURLToPath(new URL("../../src/site/core/classbeat-start-model.ts", import.meta.url));
    assert.deepEqual(impurities(path, readFileSync(path, "utf8")), []);
  });
});
