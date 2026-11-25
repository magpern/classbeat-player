// The mix cache's pure core (ADR 0013 section 3): the mix tag and per-file keys, the chunk seal and
// what it binds, the record layout, the header's authentication, the resume rule and eviction.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aadOf, CHUNK_BYTES, fileKey, GCM_TAG_BYTES, headerKey, mixTag, nonceOf, openChunk, sealChunk } from "../../src/core/mix/cache-crypto.ts";
import { checkHeader, encodeHeader, identityOf, parseHeader, sameSource } from "../../src/core/mix/cache-header.ts";
import type { MixHeader } from "../../src/core/mix/cache-header.ts";
import { chunkCount, plainEnd, plainLength, sealedEnd, sealedStart, wholeChunks } from "../../src/core/mix/cache-layout.ts";
import { DAY_MS, DEFAULT_CAP_BYTES, evictionPlan, EXPIRY_MS } from "../../src/core/mix/eviction-policy.ts";

const K = Buffer.alloc(32, 7);
const K2 = Buffer.alloc(32, 8);
const ID = Buffer.alloc(32, 1);
const ID2 = Buffer.alloc(32, 2);

describe("keys and the mix tag", () => {
  it("names a mix by an HMAC of its id under the account's key, never the id", () => {
    const t = mixTag(K, "mix-1");
    assert.equal(t.length, 32);
    assert.deepEqual(t, mixTag(K, "mix-1"));
    assert.notDeepEqual(t, mixTag(K, "mix-2"));
    assert.notDeepEqual(t, mixTag(K2, "mix-1"));
    assert.ok(!t.toString("hex").includes(Buffer.from("mix-1").toString("hex")));
  });
  it("derives a different chunk key per file id and per mix tag, and a separate header key", () => {
    const t = mixTag(K, "m");
    const k = fileKey(K, ID, t);
    assert.equal(k.length, 32);
    assert.notDeepEqual(k, fileKey(K, ID2, t));
    assert.notDeepEqual(k, fileKey(K, ID, mixTag(K, "n")));
    assert.notDeepEqual(k, fileKey(K2, ID, t));
    assert.notDeepEqual(k, headerKey(K, ID, t));
    assert.throws(() => fileKey(Buffer.alloc(16), ID, t));
    assert.throws(() => fileKey(K, Buffer.alloc(31), t));
  });
  it("uses the chunk index as a 96-bit big-endian nonce and binds file, tag, index and final flag", () => {
    assert.equal(nonceOf(0).toString("hex"), "000000000000000000000000");
    assert.equal(nonceOf(258).toString("hex"), "000000000000000000000102");
    assert.throws(() => nonceOf(-1));
    const t = mixTag(K, "m");
    const aad = aadOf(ID, t, 3, true);
    assert.equal(aad.length, 32 + 32 + 9);
    assert.equal(aad.subarray(64).toString("hex"), "000000000000000301");
  });
});

describe("a sealed chunk", () => {
  const tag = mixTag(K, "m");
  const place = { key: fileKey(K, ID, tag), fileId: ID, tag, index: 2, final: false };
  const plain = Buffer.from("plain chunk bytes");
  const sealed = sealChunk(place, plain);
  it("opens where it was sealed, and is ciphertext plus a 16-byte tag", () => {
    assert.equal(sealed.length, plain.length + GCM_TAG_BYTES);
    assert.ok(!sealed.includes(plain));
    assert.deepEqual(openChunk(place, sealed), plain);
  });
  it("fails anywhere else: another index, final flag, file id, mix tag or key, or any flipped bit", () => {
    assert.equal(openChunk({ ...place, index: 3 }, sealed), null);
    assert.equal(openChunk({ ...place, final: true }, sealed), null);
    assert.equal(openChunk({ ...place, fileId: ID2 }, sealed), null);
    assert.equal(openChunk({ ...place, tag: mixTag(K, "n") }, sealed), null);
    assert.equal(openChunk({ ...place, key: fileKey(K, ID2, tag) }, sealed), null);
    for (let i = 0; i < sealed.length; i++) {
      const bad = Buffer.from(sealed);
      bad[i]! ^= 1;
      assert.equal(openChunk(place, bad), null, `bit flipped at ${i}`);
    }
    assert.equal(openChunk(place, sealed.subarray(0, 10)), null);
  });
});

describe("the record layout", () => {
  const len = 2 * CHUNK_BYTES + 100;
  it("cuts 256 KiB chunks, the last one short", () => {
    assert.equal(chunkCount(len), 3);
    assert.equal(chunkCount(CHUNK_BYTES), 1);
    assert.equal(plainLength(len, 2), 100);
    assert.equal(plainEnd(len, 3), len);
    assert.equal(sealedStart(1), CHUNK_BYTES + GCM_TAG_BYTES);
    assert.equal(sealedEnd(len, 3), len + 3 * GCM_TAG_BYTES);
  });
  it("counts whole records only; what follows them is torn", () => {
    assert.equal(wholeChunks(len, 0), 0);
    assert.equal(wholeChunks(len, sealedEnd(len, 1) - 1), 0);
    assert.equal(wholeChunks(len, sealedEnd(len, 1)), 1);
    assert.equal(wholeChunks(len, sealedEnd(len, 2) + 50), 2);
    assert.equal(wholeChunks(len, sealedEnd(len, 3) - 1), 2);
    assert.equal(wholeChunks(len, sealedEnd(len, 3)), 3);
    assert.equal(wholeChunks(len, sealedEnd(len, 3) + 99), 3);
  });
});

describe("the header", () => {
  const tag = mixTag(K, "m").toString("hex");
  const h: MixHeader = { fileId: ID.toString("hex"), tag, byteLength: 1000, sha256: null, sourceVersion: "v1", state: "complete", usedAt: 5 };
  const mac = headerKey(K, ID, Buffer.from(tag, "hex"));
  const bytes = encodeHeader(h, mac);
  it("holds no mix id and verifies under its key and tag", () => {
    assert.ok(!bytes.toString().includes('"m"'));
    assert.deepEqual(checkHeader(parseHeader(bytes)!, mac, tag), h);
  });
  it("detects a change to any field, another key, or another tag", () => {
    const fields: Record<string, unknown> = { fileId: ID2.toString("hex"), byteLength: 999, sha256: "a".repeat(64), sourceVersion: "v2", state: "downloading", usedAt: 6, chunks: 2, format: 2 };
    for (const [k, v] of Object.entries(fields)) {
      const o = JSON.parse(bytes.toString());
      o[k] = v;
      const p = parseHeader(Buffer.from(JSON.stringify(o)));
      assert.ok(p === null || checkHeader(p, mac, tag) === null, k);
    }
    assert.equal(checkHeader(parseHeader(bytes)!, headerKey(K2, ID, Buffer.from(tag, "hex")), tag), null);
    assert.equal(checkHeader(parseHeader(bytes)!, mac, mixTag(K, "n").toString("hex")), null);
    for (const junk of ["", "{", "[]", "null", "x".repeat(3000)]) assert.equal(parseHeader(Buffer.from(junk)), null);
  });
});

describe("the resume rule", () => {
  const d = { byteLength: 10, durationMs: 1, mayPlay: true };
  it("accepts only a sane description", () => {
    assert.deepEqual(identityOf({ ...d, version: "v1" }, 100), { byteLength: 10, sha256: null, sourceVersion: "v1" });
    assert.deepEqual(identityOf({ ...d, sha256: "A".repeat(64) }, 100)?.sha256, "a".repeat(64));
    for (const bad of [{ ...d, byteLength: 0 }, { ...d, byteLength: 101 }, { ...d, byteLength: 1.5 }, { ...d, sha256: "xyz" }, { ...d, version: "" }, { ...d, version: "has space" }]) assert.equal(identityOf(bad, 100), null);
  });
  it("resumes only on the same length and identity, and never without one", () => {
    const a = { byteLength: 10, sha256: null, sourceVersion: "v1" };
    assert.ok(sameSource(a, { ...a }));
    assert.ok(!sameSource(a, { ...a, sourceVersion: "v2" }));
    assert.ok(!sameSource(a, { ...a, byteLength: 11 }));
    assert.ok(!sameSource(a, { ...a, sha256: "a".repeat(64) }));
    const none = { byteLength: 10, sha256: null, sourceVersion: null };
    assert.ok(!sameSource(none, { ...none }));
  });
});

describe("the eviction policy, on a fake clock", () => {
  const now = 1_000 * DAY_MS;
  const m = (tag: string, bytes: number, ageDays: number) => ({ tag, bytes, usedAt: now - ageDays * DAY_MS });
  it("has a 4 GiB default cap and a 90-day expiry", () => {
    assert.equal(DEFAULT_CAP_BYTES, 4 * 1024 ** 3);
    assert.equal(EXPIRY_MS, 90 * DAY_MS);
  });
  it("deletes the least recently used first until under the cap, a kept one only after every other", () => {
    const mixes = [m("a", 40, 1), m("b", 40, 3), m("c", 40, 2), m("d", 40, 10)];
    assert.deepEqual(evictionPlan(mixes, { now, capBytes: 100, keep: new Set() }), ["d", "b"]);
    assert.deepEqual(evictionPlan(mixes, { now, capBytes: 100, keep: new Set(["d"]) }), ["b", "c"]);
    assert.deepEqual(evictionPlan(mixes, { now, capBytes: 160, keep: new Set() }), []);
    // Kept mixes go above the cap too, least recently used first, after the others.
    assert.deepEqual(evictionPlan(mixes, { now, capBytes: 40, keep: new Set(["b", "d"]) }), ["c", "a", "d"]);
    assert.deepEqual(evictionPlan(mixes, { now, capBytes: 0, keep: new Set(["a", "b", "c", "d"]) }), ["d", "b", "c", "a"]);
  });
  it("never deletes a pinned mix (the one playing, the open class's), however full", () => {
    const mixes = [m("a", 40, 1), m("b", 40, 3), m("c", 40, 2), m("d", 40, 10)];
    assert.deepEqual(evictionPlan(mixes, { now, capBytes: 0, keep: new Set(["a", "b"]), pinned: new Set(["d"]) }), ["c", "b", "a"]);
    assert.deepEqual(evictionPlan(mixes, { now, capBytes: 0, keep: new Set(), pinned: new Set(["a", "b", "c", "d"]) }), []);
    // Pinned beats the other rules: not named, not used for a year.
    assert.deepEqual(evictionPlan([m("x", 1, 365)], { now, capBytes: 0, keep: new Set(), pinned: new Set(["x"]), named: new Set() }), []);
  });
  it("expires a mix not used for 90 days, unless kept", () => {
    const mixes = [m("a", 1, 89.9), m("b", 1, 90), m("c", 1, 200)];
    assert.deepEqual(evictionPlan(mixes, { now, capBytes: 100, keep: new Set() }), ["b", "c"]);
    assert.deepEqual(evictionPlan(mixes, { now, capBytes: 100, keep: new Set(["c"]) }), ["b"]);
  });
  it("deletes a mix no class names any more, unless kept", () => {
    const mixes = [m("a", 1, 1), m("b", 1, 1)];
    assert.deepEqual(evictionPlan(mixes, { now, capBytes: 100, keep: new Set(), named: new Set(["a"]) }), ["b"]);
    assert.deepEqual(evictionPlan(mixes, { now, capBytes: 100, keep: new Set(["b"]), named: new Set(["a"]) }), []);
  });
});
