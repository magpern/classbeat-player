// Downloading into the encrypted mix cache (ADR 0013 section 3) on the fake source: a whole download
// reads back, a download resumes only from the same source, a changed source starts over under a new
// file id, a torn record is replaced only by the same sealed bytes, and no chunk index is ever sealed
// with two different plaintexts under one key. Every refusal is covered too.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { CHUNK_BYTES, sealChunk } from "../../src/core/mix/cache-crypto.ts";
import { sealedEnd, sealedStart, wholeChunks } from "../../src/core/mix/cache-layout.ts";
import { keysOf } from "../../src/main/mix/cache-entry.ts";
import { ACCT, OTHER } from "./mix-fakes.ts";
import { FAKE_TOKEN } from "./fake-mix-source.ts";
import { makeRig, MIX_BYTES } from "./mix-cache-rig.ts";
import type { Rig } from "./mix-cache-rig.ts";

const M = "mix-1";
let rig: Rig;
afterEach(() => rig.done());

/** The sealed record of chunk `i` as the cache would write it for the current entry. */
function sealedRecord(r: Rig, i: number, plain: Uint8Array): Buffer {
  const h = r.header(M)!;
  const k = keysOf(r.vault.loadKey(ACCT)!, h.fileId, h.tag);
  return sealChunk({ key: k.chunkKey, fileId: k.fileId, tag: k.tag, index: i, final: false }, Buffer.from(plain));
}

/** Every record ever seen on disk per (file id, index); a second, different sealing of one throws. */
function ledger() {
  const seen = new Map<string, Buffer>();
  const note = (key: string, rec: Buffer): void => {
    const had = seen.get(key);
    if (had === undefined) return void seen.set(key, rec);
    const [short, long] = had.length <= rec.length ? [had, rec] : [rec, had];
    if (!long.subarray(0, short.length).equals(short)) throw new Error(`index sealed twice with other bytes: ${key}`);
    seen.set(key, long);
  };
  return {
    note,
    snapshot(r: Rig): void {
      const h = r.header(M);
      if (h === null || !existsSync(r.mixPath(M))) return;
      const file = readFileSync(r.mixPath(M));
      const n = wholeChunks(h.byteLength, file.length);
      for (let i = 0; i < n; i++) note(`${h.fileId}:${i}`, file.subarray(sealedStart(i), sealedEnd(h.byteLength, i + 1)));
      if (file.length > sealedStart(n) && n < 3) note(`${h.fileId}:${n}`, file.subarray(sealedStart(n)));
    },
  };
}

describe("a download into the cache", () => {
  it("reads back whole, chunk by chunk, and a second download reads nothing", async () => {
    rig = makeRig();
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    assert.deepEqual(await rig.readAll(M), Buffer.from(rig.source.bytes));
    const reader = rig.cache.open(ACCT, M)!;
    assert.equal(reader.complete, true);
    assert.equal(reader.chunks, 3);
    assert.equal(reader.chunkLength(2), 1000);
    await assert.rejects(reader.readChunk(3), RangeError);
    const before = rig.source.calls.length;
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    assert.deepEqual(rig.source.calls.slice(before), [`describe ${M}`]);
  });

  it("keeps each account apart: its own key, tag and folder", async () => {
    rig = makeRig();
    rig.vault.saveToken(OTHER, FAKE_TOKEN);
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    assert.equal(rig.cache.open(OTHER, M), null);
    assert.equal(await rig.cache.download(OTHER, M), "complete");
    assert.notEqual(rig.tagOf(M, ACCT), rig.tagOf(M, OTHER));
    assert.notDeepEqual(readFileSync(rig.mixPath(M, ACCT)), readFileSync(rig.mixPath(M, OTHER)));
    assert.deepEqual(await rig.readAll(M, OTHER), Buffer.from(rig.source.bytes));
  });

  it("resumes after a dropped connection from the first missing chunk, under the same file id", async () => {
    rig = makeRig();
    rig.source.failAfterBytes = CHUNK_BYTES + 100;
    assert.equal(await rig.cache.download(ACCT, M), "interrupted");
    const first = rig.header(M)!;
    assert.equal(first.state, "downloading");
    const r = rig.cache.open(ACCT, M)!;
    assert.equal(r.complete, false);
    assert.equal((await r.readChunk(0)).ok, true);
    assert.deepEqual(await r.readChunk(1), { ok: false, reason: "pending" });
    rig.source.failAfterBytes = null;
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    assert.equal(rig.header(M)!.fileId, first.fileId);
    assert.equal(rig.source.calls.at(-1), `read ${M} ${CHUNK_BYTES}`);
    assert.deepEqual(await rig.readAll(M), Buffer.from(rig.source.bytes));
  });

  it("starts over under a new file id when the source changed, and never reuses a nonce under one key", async () => {
    rig = makeRig();
    const L = ledger();
    rig.source.failAfterBytes = CHUNK_BYTES + 100;
    assert.equal(await rig.cache.download(ACCT, M), "interrupted");
    L.snapshot(rig);
    const first = rig.header(M)!.fileId;
    // A new version of the mix: no resume.
    rig.source.bytes = randomBytes(MIX_BYTES);
    rig.source.version = "v2";
    assert.equal(await rig.cache.download(ACCT, M), "interrupted");
    L.snapshot(rig);
    const second = rig.header(M)!.fileId;
    assert.notEqual(second, first);
    assert.equal(rig.source.calls.at(-1), `read ${M} 0`);
    // A torn record of the genuine chunk 1, then a source that lies: other bytes under the same version.
    const plain1 = rig.source.bytes.slice(CHUNK_BYTES, 2 * CHUNK_BYTES);
    appendFileSync(rig.mixPath(M), sealedRecord(rig, 1, plain1).subarray(0, 5000));
    L.snapshot(rig);
    const lie = Buffer.from(rig.source.bytes);
    lie[CHUNK_BYTES + 10]! ^= 0xff;
    rig.source.bytes = lie;
    rig.source.failAfterBytes = null;
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    L.snapshot(rig);
    const third = rig.header(M)!.fileId;
    assert.ok(third !== first && third !== second);
    assert.deepEqual(await rig.readAll(M), lie);
    // A changed length or SHA-256 starts over too.
    rig.source.bytes = randomBytes(MIX_BYTES + 1);
    rig.source.version = "v3";
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    L.snapshot(rig);
    assert.notEqual(rig.header(M)!.fileId, third);
    assert.deepEqual(await rig.readAll(M), Buffer.from(rig.source.bytes));
  });

  it("the ledger above does catch a second sealing with other bytes", () => {
    const L = ledger();
    L.note("f:1", Buffer.from("abcdef"));
    L.note("f:1", Buffer.from("abc"));
    assert.throws(() => L.note("f:1", Buffer.from("abX")), /sealed twice/);
  });

  it("resumes over a torn record of the same chunk, keeping its file id", async () => {
    rig = makeRig();
    rig.source.failAfterBytes = CHUNK_BYTES + 100;
    await rig.cache.download(ACCT, M);
    const id = rig.header(M)!.fileId;
    appendFileSync(rig.mixPath(M), sealedRecord(rig, 1, rig.source.bytes.slice(CHUNK_BYTES, 2 * CHUNK_BYTES)).subarray(0, 7000));
    rig.source.failAfterBytes = null;
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    assert.equal(rig.header(M)!.fileId, id);
    assert.deepEqual(await rig.readAll(M), Buffer.from(rig.source.bytes));
  });

  it("starts over when the torn bytes are anything else", async () => {
    rig = makeRig();
    rig.source.failAfterBytes = CHUNK_BYTES + 100;
    await rig.cache.download(ACCT, M);
    const id = rig.header(M)!.fileId;
    appendFileSync(rig.mixPath(M), randomBytes(300));
    rig.source.failAfterBytes = null;
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    assert.notEqual(rig.header(M)!.fileId, id);
    assert.deepEqual(await rig.readAll(M), Buffer.from(rig.source.bytes));
  });

  it("checks the stated SHA-256, and resumes on it without a version", async () => {
    rig = makeRig();
    rig.source.version = undefined;
    rig.source.sha256 = createHash("sha256").update(rig.source.bytes).digest("hex");
    rig.source.failAfterBytes = CHUNK_BYTES + 100;
    assert.equal(await rig.cache.download(ACCT, M), "interrupted");
    rig.source.failAfterBytes = null;
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    assert.equal(rig.source.calls.at(-1), `read ${M} ${CHUNK_BYTES}`);
    rig.source.sha256 = "0".repeat(64);
    rig.source.version = "v9";
    assert.equal(await rig.cache.download(ACCT, M), "bad");
    assert.ok(!existsSync(rig.hdrPath(M)) && !existsSync(rig.mixPath(M)));
    assert.equal(rig.cache.open(ACCT, M), null);
  });

  it("never resumes a source that states neither a SHA-256 nor a version", async () => {
    rig = makeRig();
    rig.source.version = undefined;
    rig.source.failAfterBytes = CHUNK_BYTES + 100;
    await rig.cache.download(ACCT, M);
    rig.source.failAfterBytes = null;
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    assert.equal(rig.source.calls.at(-1), `read ${M} 0`);
  });

  it("drops a source that sends more bytes than it stated", async () => {
    rig = makeRig();
    rig.source.statedByteLength = MIX_BYTES - 10;
    assert.equal(await rig.cache.download(ACCT, M), "bad");
    assert.ok(!existsSync(rig.mixPath(M)));
  });

  it("gives up on a stalled stream after the idle time, and resumes later", async () => {
    rig = makeRig(undefined, { idleMs: 30 });
    rig.source.stallAfterChunks = 5;
    assert.equal(await rig.cache.download(ACCT, M), "interrupted");
    rig.source.stallAfterChunks = null;
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    assert.equal(rig.source.calls.at(-1), `read ${M} ${CHUNK_BYTES}`);
  });

  it("answers each refusal without writing", async () => {
    rig = makeRig();
    assert.equal(await rig.cache.download(ACCT, "../x"), "not_found");
    assert.equal(await rig.cache.download(OTHER, M), "signed_out");
    assert.equal(rig.source.calls.length, 0);
    rig.source.tokenInvalid = true;
    assert.equal(await rig.cache.download(ACCT, M), "token_invalid");
    assert.deepEqual(rig.invalid, [ACCT]);
    rig.source.tokenInvalid = false;
    rig.rebuild({ capBytes: MIX_BYTES - 1 });
    assert.equal(await rig.cache.download(ACCT, M), "too_large");
    rig.rebuild();
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    rig.source.mayPlay = false;
    assert.equal(await rig.cache.download(ACCT, M), "not_allowed");
    assert.ok(!existsSync(rig.hdrPath(M)) && !existsSync(rig.mixPath(M)));
  });

  it("opens nothing once the account holds no token", async () => {
    rig = makeRig();
    await rig.cache.download(ACCT, M);
    rig.vault.clearToken(ACCT);
    assert.equal(rig.cache.open(ACCT, M), null);
  });
});
