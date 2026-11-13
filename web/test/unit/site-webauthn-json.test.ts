// WebAuthn's JSON form for passkey sign-in (ADR 0002, section 4).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertionBody, base64urlToBytes, bytesToBase64url, requestOptionsOf } from "../../src/site/core/webauthn-json.ts";

const buf = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe("WebAuthn JSON", () => {
  it("round-trips base64url", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const text = bytesToBase64url(bytes);
    assert.equal(text, "AAEC-vv8_f7_");
    assert.deepEqual([...base64urlToBytes(text)], [...bytes]);
    assert.throws(() => base64urlToBytes("a+b/"));
  });

  it("turns the backend's options into the browser's, with no credentials listed", () => {
    const o = requestOptionsOf({ challenge: "AAECAw", timeout: 300000, rpId: "site.test", allowCredentials: [], userVerification: "required" });
    assert.ok(o);
    assert.deepEqual([...new Uint8Array(o.challenge as ArrayBuffer)], [0, 1, 2, 3]);
    assert.deepEqual(o.allowCredentials, []);
    assert.equal(o.rpId, "site.test");
    assert.equal(o.userVerification, "required");
    assert.equal(requestOptionsOf({}), null);
    assert.equal(requestOptionsOf({ challenge: "not base64url!" }), null);
    assert.equal(requestOptionsOf(null), null);
  });

  it("sends the assertion in the shape the backend reads", () => {
    const body = assertionBody({ id: "Y3JlZA", rawId: buf("cred"), type: "public-key", authenticatorAttachment: "platform", response: { clientDataJSON: buf("{}"), authenticatorData: buf("ad"), signature: buf("sig"), userHandle: null } });
    assert.deepEqual(body, { credential: { id: "Y3JlZA", rawId: "Y3JlZA", type: "public-key", authenticatorAttachment: "platform", response: { clientDataJSON: "e30", authenticatorData: "YWQ", signature: "c2ln" } } });
  });
});
