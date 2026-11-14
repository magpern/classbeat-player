// WebAuthn's JSON form for adding a passkey (src/site/core/webauthn-create.ts; ADR 0002, section
// 4): the backend's options become the browser's, and the new credential goes back in the form the
// backend reads.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attestationCredential, creationOptionsOf } from "../../src/site/core/webauthn-create.ts";

const b64 = (s: string): string => Buffer.from(s).toString("base64url");
const bytes = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
const text = (b: BufferSource): string => new TextDecoder().decode(b);
const OPTIONS = {
  rp: { name: "Class player", id: "site.test" },
  user: { id: b64("user-handle"), name: "ana@example.com", displayName: "ana@example.com" },
  challenge: b64("challenge"),
  pubKeyCredParams: [
    { type: "public-key", alg: -7 },
    { type: "public-key", alg: -257 },
  ],
  timeout: 300000,
  excludeCredentials: [{ id: b64("existing-1"), type: "public-key", transports: ["internal"] }],
  authenticatorSelection: { residentKey: "required", userVerification: "required" },
  attestation: "none",
};

describe("the creation options", () => {
  it("decode the binary fields and keep the rest", () => {
    const o = creationOptionsOf(OPTIONS);
    assert.ok(o);
    assert.equal(text(o.challenge), "challenge");
    assert.equal(text(o.user.id), "user-handle");
    assert.deepEqual(o.rp, { name: "Class player", id: "site.test" });
    assert.deepEqual(o.pubKeyCredParams, OPTIONS.pubKeyCredParams);
    const exclude = o.excludeCredentials ?? [];
    assert.equal(exclude.length, 1);
    assert.equal(text(exclude[0].id), "existing-1");
    assert.deepEqual(exclude[0].transports, ["internal"]);
    assert.equal(o.timeout, 300000);
    assert.equal(o.attestation, "none");
    assert.equal(o.authenticatorSelection?.residentKey, "required");
  });

  it("are null for anything else", () => {
    const bad: unknown[] = [
      null,
      [],
      {},
      { ...OPTIONS, challenge: 1 },
      { ...OPTIONS, rp: { id: "x" } },
      { ...OPTIONS, user: { ...OPTIONS.user, id: 2 } },
      { ...OPTIONS, pubKeyCredParams: [{ type: "other", alg: -7 }] },
      { ...OPTIONS, excludeCredentials: [{ type: "public-key" }] },
      { ...OPTIONS, challenge: "not base64url!" },
    ];
    for (const b of bad) assert.equal(creationOptionsOf(b), null, JSON.stringify(b));
  });
});

describe("the attestation sent back", () => {
  it("is the backend's JSON form, with at most 10 transports", () => {
    const c = attestationCredential({
      id: b64("cred"),
      rawId: bytes("cred"),
      type: "public-key",
      authenticatorAttachment: "cross-platform",
      response: { clientDataJSON: bytes("cdj"), attestationObject: bytes("att"), getTransports: () => Array.from({ length: 12 }, () => "usb") },
    });
    assert.deepEqual(Object.keys(c).sort(), ["authenticatorAttachment", "id", "rawId", "response", "type"]);
    assert.equal(c.rawId, b64("cred"));
    const r = c.response as Record<string, unknown>;
    assert.equal(r.clientDataJSON, b64("cdj"));
    assert.equal(r.attestationObject, b64("att"));
    assert.equal((r.transports as string[]).length, 10);
  });

  it("leaves out what the browser does not give", () => {
    const c = attestationCredential({ id: "x", rawId: bytes("x"), type: "public-key", response: { clientDataJSON: bytes("c"), attestationObject: bytes("a") } });
    assert.equal("authenticatorAttachment" in c, false);
    assert.equal("transports" in (c.response as object), false);
  });
});
