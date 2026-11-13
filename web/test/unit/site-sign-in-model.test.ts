// The sign-in page's states (docs/design/site.md, "Sign in"; ADR 0002, sections 4 and 10).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { afterLinkAsked, afterLinkUsed, afterPasskey, plateWords } from "../../src/site/core/sign-in-model.ts";
import { fragmentOf } from "../../src/site/core/link-token.ts";
import type { Answer } from "../../src/site/core/answer.ts";

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
  const assertion = (answer: Answer) => ({ step: "assertion", answer }) as const;
  const options = (answer: Answer) => ({ step: "options", answer }) as const;

  it("signs in, fails as one, or waits on the limit", () => {
    assert.deepEqual(afterPasskey("", assertion({ kind: "ok", status: 200, body: {} })), { screen: "signed-in" });
    assert.deepEqual(afterPasskey("x", "cancelled"), { screen: "form", email: "x", plate: { kind: "passkey-failed" } });
    assert.deepEqual(afterPasskey("", assertion({ kind: "refused", status: 401, code: "sign_in_refused" })), { screen: "form", email: "", plate: { kind: "passkey-failed" } });
    assert.deepEqual(afterPasskey("", assertion({ kind: "too_many", retryAfter: 420 })), { screen: "form", email: "", plate: { kind: "passkey-limited", retryAfter: 420 } });
  });

  it("names failed sign-ins only for their own limit (#257)", () => {
    // The options' limit counts sign-ins started, not failed ones.
    assert.deepEqual(afterPasskey("", options({ kind: "too_many", retryAfter: 420 })), { screen: "form", email: "", plate: { kind: "passkey-wait", retryAfter: 420 } });
    // Busy: another attempt from the same address is still being checked.
    assert.deepEqual(afterPasskey("", assertion({ kind: "too_many", retryAfter: 1 })), { screen: "form", email: "", plate: { kind: "passkey-wait", retryAfter: 1 } });
    assert.deepEqual(afterPasskey("", assertion({ kind: "too_many", retryAfter: null })), { screen: "form", email: "", plate: { kind: "passkey-wait", retryAfter: null } });
    assert.deepEqual(afterPasskey("", assertion({ kind: "too_many", retryAfter: 2 })), { screen: "form", email: "", plate: { kind: "passkey-limited", retryAfter: 2 } });
  });

  it("does not sign in on the options alone", () => {
    assert.deepEqual(afterPasskey("", options({ kind: "ok", status: 200, body: {} })), { screen: "form", email: "", plate: { kind: "server" } });
    assert.deepEqual(afterPasskey("", options({ kind: "offline" })), { screen: "form", email: "", plate: { kind: "offline" } });
  });
});

describe("the words", () => {
  it("state the limits as ADR 0002 section 10 does, and never say whether an address may sign in", () => {
    assert.match(plateWords({ kind: "link-limited", retryAfter: 3000 }).detail, /in about 50 minutes\. One network connection can ask for 10 sign-in links an hour/);
    assert.match(plateWords({ kind: "passkey-limited", retryAfter: 420 }).detail, /in about 7 minutes\. After 10 passkey sign-ins that fail within 10 minutes/);
    assert.deepEqual(plateWords({ kind: "passkey-wait", retryAfter: 420 }), { head: "Too many sign-in requests", detail: "Please try again in about 7 minutes." });
    assert.deepEqual(plateWords({ kind: "passkey-wait", retryAfter: 1 }), { head: "Too many sign-in requests", detail: "Please try again in a moment." });
    assert.deepEqual(plateWords({ kind: "passkey-wait", retryAfter: null }), { head: "Too many sign-in requests", detail: "Please try again in a few minutes." });
    for (const kind of ["passkey-failed", "link-refused", "offline", "server"] as const) {
      const w = plateWords({ kind });
      assert.doesNotMatch(`${w.head} ${w.detail}`, /not allowed|no account|not on the|cannot sign in|unknown address|\d{3}|_/i);
    }
  });
});
