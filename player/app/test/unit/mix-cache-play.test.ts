// The cache under playback (issue #693): a download whose entry is evicted at the end is not brought
// back, the chunk still being written reads as pending rather than bad, sign-out stops the account's
// downloads before its folder goes, and a short write is finished. Fake source, temporary folder.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { CHUNK_BYTES } from "../../src/core/mix/cache-crypto.ts";
import { sealedStart } from "../../src/core/mix/cache-layout.ts";
import { ACCT } from "./mix-fakes.ts";
import { makeRig, MIX_BYTES } from "./mix-cache-rig.ts";
import type { Rig } from "./mix-cache-rig.ts";

const M = "mix-1";
let rig: Rig;
afterEach(() => rig.done());

const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok(), "condition never held");
};

function flipByte(path: string, at: number): void {
  const fd = openSync(path, "r+");
  try {
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, at);
    b[0] = (b[0] ?? 0) ^ 0xff;
    writeSync(fd, b, 0, 1, at);
  } finally {
    closeSync(fd);
  }
}

describe("mix cache during playback", () => {
  it("N1: an entry evicted while its last chunk was written is not saved complete", async () => {
    rig = makeRig();
    const read = rig.source.read.bind(rig.source);
    rig.source.read = async (token, mixId, from) => {
      const r = await read(token, mixId, from);
      if (!r.ok) return r;
      const inner = r.bytes;
      async function* evictedAtEnd(): AsyncGenerator<Uint8Array> {
        yield* inner;
        // Every byte is written; the entry goes (eviction, sign-out) before the header is finished.
        rmSync(rig.hdrPath(M), { force: true });
        rmSync(rig.mixPath(M), { force: true });
      }
      return { ok: true, bytes: evictedAtEnd() };
    };
    assert.equal(await rig.cache.download(ACCT, M), "interrupted");
    assert.equal(existsSync(rig.hdrPath(M)), false);
    assert.equal(rig.cache.open(ACCT, M), null);
  });

  it("N2: the last chunk on disk of a running download reads pending when it does not open; an earlier one is bad", async () => {
    rig = makeRig();
    rig.source.failAfterBytes = 2 * CHUNK_BYTES;
    assert.equal(await rig.cache.download(ACCT, M), "interrupted");
    flipByte(rig.mixPath(M), sealedStart(1) + 10);
    const r = rig.cache.open(ACCT, M)!;
    assert.deepEqual(await r.readChunk(1), { ok: false, reason: "pending" });
    assert.equal(rig.header(M)?.state, "downloading");
    assert.equal((await r.readChunk(0)).ok, true);
    flipByte(rig.mixPath(M), sealedStart(0) + 10);
    assert.deepEqual(await r.readChunk(0), { ok: false, reason: "bad" });
  });

  it("N4: cancel stops a stalled download and drops the waiting ones before it resolves", async () => {
    rig = makeRig();
    rig.source.stallAfterChunks = 2;
    const running = rig.cache.download(ACCT, M);
    const waiting = rig.cache.download(ACCT, "mix-2");
    await until(() => rig.source.calls.includes(`read ${M} 0`));
    const t0 = Date.now();
    await rig.cache.cancel(ACCT);
    assert.ok(Date.now() - t0 < 2000, "cancel waited for the idle timeout");
    assert.equal(await running, "interrupted");
    assert.equal(await waiting, "signed_out");
    assert.ok(!rig.source.calls.some((c) => c.includes("mix-2")));
    // A download asked for after the cancel runs again.
    rig.source.stallAfterChunks = null;
    assert.equal(await rig.cache.download(ACCT, M), "complete");
  });

  it("N5: a write that takes fewer bytes than asked is finished", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cbp-probe-"));
    const probe = await open(join(dir, "probe"), "w");
    const proto = Object.getPrototypeOf(probe) as { write: (...a: unknown[]) => Promise<{ bytesWritten: number }> };
    await probe.close();
    rmSync(dir, { recursive: true, force: true });
    const real = proto.write;
    let shortened = 0;
    proto.write = function (this: unknown, buf: unknown, off: unknown, len: unknown, pos: unknown) {
      if (Buffer.isBuffer(buf) && typeof len === "number" && len > 1000) {
        shortened++;
        return real.call(this, buf, off, 1000, pos);
      }
      return real.call(this, buf, off, len, pos);
    };
    try {
      const bytes = randomBytes(MIX_BYTES);
      rig = makeRig(bytes);
      assert.equal(await rig.cache.download(ACCT, M), "complete");
      assert.ok(shortened > 0);
      assert.ok((await rig.readAll(M))?.equals(bytes));
    } finally {
      proto.write = real;
    }
  });
});

