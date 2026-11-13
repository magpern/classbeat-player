// The sign-in page's states (docs/design/site.md, "Sign in"; ADR 0002, sections 4 and 10).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { afterLinkAsked, afterLinkUsed, afterPasskey, plateWords } from "../../src/site/core/sign-in-model.ts";
import { fragmentOf } from "../../src/site/core/link-token.ts";

const TOKEN = `cbp_ml_${"a".repeat(43)}`;

describe("asking for a link", () => {
  it("gives one page for every accepted address, whatever the body says", () => {
    const a = afterLinkAsked("ana@example.com", { kind: "ok", status: 200, body: { status: "accepted" } });
    const b = afterLinkAsked("ana@example.com", { kind: "ok", status: 200, body: { status: "something else", allowed: false } });
    assert.deepEqual(a, { screen: "sent", email: "ana@example.com" });
    assert.deepEqual(b, a);
  });

  it("keeps the form and the typed text for a refusal, a limit and a fault", () => {
    assert.deepEqual(afterLinkAsked("ana@example", { kind: "refused", status: 422, code: "invalid_email" }), { screen: "form", email: "ana@example", emailError: true });
    assert.deepEqual(afterLinkAsked("a@b.c", { kind: "too_many", retryAfter: 60 }), { screen: "form", email: "a@b.c", plate: { kind: "link-limited", retryAfter: 60 } });
    assert.deepEqual(afterLinkAsked("a@b.c", { kind: "offline" }), { screen: "form", email: "a@b.c", plate: { kind: "offline" } });
    assert.deepEqual(afterLinkAsked("a@b.c", { kind: "server" }), { screen: "form", email: "a@b.c", plate: { kind: "server" } });
  });
});

describe("using a link", () => {
  it("signs in on 200 and gives one answer for every refusal", () => {
    assert.deepEqual(afterLinkUsed({ kind: "ok", status: 200, body: {} }), { screen: "signed-in" });
    for (const code of ["sign_in_refused", "invalid_request"]) {
      assert.deepEqual(afterLinkUsed({ kind: "refused", status: 401, code }), { screen: "form", email: "", plate: { kind: "link-refused" } });
    }
    assert.deepEqual(afterLinkUsed({ kind: "offline" }), { screen: "link", busy: false, plate: { kind: "offline" } });
  });

  it("reads only a well-formed link token from the fragment", () => {
    assert.deepEqual(fragmentOf(`#${TOKEN}`), { kind: "token", token: TOKEN });
    assert.deepEqual(fragmentOf(`#${TOKEN.slice(0, 30)}`), { kind: "broken" });
    assert.deepEqual(fragmentOf(`#${TOKEN}x`), { kind: "broken" });
    assert.deepEqual(fragmentOf("#main"), { kind: "none" });
    assert.deepEqual(fragmentOf(""), { kind: "none" });
    assert.deepEqual(fragmentOf(`#cbp_ses_${"a".repeat(43)}`), { kind: "none" });
  });
});

describe("a passkey", () => {
  it("signs in, fails as one, or waits on the limit", () => {
    assert.deepEqual(afterPasskey("", { kind: "ok", status: 200, body: {} }), { screen: "signed-in" });
    assert.deepEqual(afterPasskey("x", "cancelled"), { screen: "form", email: "x", plate: { kind: "passkey-failed" } });
    assert.deepEqual(afterPasskey("", { kind: "refused", status: 401, code: "sign_in_refused" }), { screen: "form", email: "", plate: { kind: "passkey-failed" } });
    assert.deepEqual(afterPasskey("", { kind: "too_many", retryAfter: 420 }), { screen: "form", email: "", plate: { kind: "passkey-limited", retryAfter: 420 } });
  });
});

describe("the words", () => {
  it("state the limits as ADR 0002 section 10 does, and never say whether an address may sign in", () => {
    assert.match(plateWords({ kind: "link-limited", retryAfter: 3000 }).detail, /in about 50 minutes\. One network connection can ask for 10 sign-in links an hour/);
    assert.match(plateWords({ kind: "passkey-limited", retryAfter: 420 }).detail, /in about 7 minutes\. After 10 passkey sign-ins that fail within 10 minutes/);
    for (const kind of ["passkey-failed", "link-refused", "offline", "server"] as const) {
      const w = plateWords({ kind });
      assert.doesNotMatch(`${w.head} ${w.detail}`, /not allowed|no account|not on the|cannot sign in|unknown address|\d{3}|_/i);
    }
  });
});
