// What an answer of the site's API means to a page (docs/design/site.md, "Errors").
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerOf, retryAfterOf, waitWords } from "../../src/site/core/answer.ts";

describe("site answers", () => {
  it("sorts every status into what the page shows", () => {
    assert.deepEqual(answerOf(200, null, { status: "accepted" }), { kind: "ok", status: 200, body: { status: "accepted" } });
    assert.deepEqual(answerOf(204, null, null), { kind: "ok", status: 204, body: null });
    assert.deepEqual(answerOf(401, null, { error: "not_signed_in" }), { kind: "not_signed_in" });
    assert.deepEqual(answerOf(401, null, { error: "sign_in_refused" }), { kind: "refused", status: 401, code: "sign_in_refused" });
    assert.deepEqual(answerOf(429, "3000", { error: "too_many_requests" }), { kind: "too_many", retryAfter: 3000 });
    assert.deepEqual(answerOf(422, null, { error: "invalid_email" }), { kind: "refused", status: 422, code: "invalid_email" });
  });

  it("shows a cross-site refusal, a server fault and anything not understood as the server fault", () => {
    for (const [status, body] of [[403, { error: "cross_site_request" }], [500, { error: "x" }], [503, null], [404, "text"], [400, { error: "<b>" }], [302, null], [0, null]] as const) {
      assert.deepEqual(answerOf(status, null, body), { kind: "server" }, String(status));
    }
  });

  it("reads Retry-After as seconds only", () => {
    assert.equal(retryAfterOf("120"), 120);
    assert.equal(retryAfterOf(" 5 "), 5);
    assert.equal(retryAfterOf("Wed, 21 Oct 2026 07:28:00 GMT"), null);
    assert.equal(retryAfterOf("-1"), null);
    assert.equal(retryAfterOf(null), null);
  });

  it("says the wait in whole minutes, rounded up", () => {
    assert.equal(waitWords(3000), "in about 50 minutes");
    assert.equal(waitWords(61), "in about 2 minutes");
    assert.equal(waitWords(1), "in about 1 minute");
    assert.equal(waitWords(0), "in about 1 minute");
    assert.equal(waitWords(null), "in a few minutes");
  });
});
