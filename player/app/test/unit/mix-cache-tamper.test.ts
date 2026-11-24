// What lies on disk in the encrypted mix cache (ADR 0013 section 3): no plaintext anywhere under the
// cache folder, files and folders this user's only, and every change to a chunk, the order of the
// records, the file's length or the header is detected, after which the mix is deleted.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, readdirSync, readFileSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { CHUNK_BYTES, GCM_TAG_BYTES } from "../../src/core/mix/cache-crypto.ts";
import { sealedStart } from "../../src/core/mix/cache-layout.ts";
import { ACCT } from "./mix-fakes.ts";
import { makeRig } from "./mix-cache-rig.ts";
import type { Rig } from "./mix-cache-rig.ts";

const M = "mix-1";
const BLOCK = 32;
let rig: Rig;
afterEach(() => rig.done());

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

/** Every offset in `hay` where one of the plaintext's aligned 32-byte blocks starts. */
function plaintextHits(plain: Uint8Array, hay: Buffer): number[] {
  const blocks = new Set<string>();
  for (let at = 0; at + BLOCK <= plain.length; at += BLOCK) blocks.add(Buffer.from(plain.subarray(at, at + BLOCK)).toString("hex"));
  const hits: number[] = [];
  for (let at = 0; at + BLOCK <= hay.length; at++) if (blocks.has(hay.subarray(at, at + BLOCK).toString("hex"))) hits.push(at);
  return hits;
}

async function downloaded(): Promise<void> {
  rig = makeRig();
  assert.equal(await rig.cache.download(ACCT, M), "complete");
}

/** Reads every chunk; true when any read answers "bad". */
async function anyBad(): Promise<boolean> {
  const r = rig.cache.open(ACCT, M);
  if (r === null) return true;
  for (let i = 0; i < r.chunks; i++) if (!(await r.readChunk(i)).ok) return true;
  return false;
}

describe("the cache folder", () => {
  it("holds no plaintext of the mix in any file, at any offset", async () => {
    await downloaded();
    rig.source.failAfterBytes = CHUNK_BYTES + 100;
    await rig.cache.download(ACCT, "mix-2");
    const files = walk(rig.root);
    assert.ok(files.length >= 4);
    for (const f of files) assert.deepEqual(plaintextHits(rig.source.bytes, readFileSync(f)), [], f);
    // The mix id is not in any name or header either.
    for (const f of files) assert.ok(!f.includes("mix-1") && !readFileSync(f).includes(Buffer.from("mix-1")), f);
  });

  it("the scan does find plaintext wherever it sits", () => {
    const plain = randomBytes(4096);
    const hay = Buffer.concat([randomBytes(77), plain.subarray(1000, 1100), randomBytes(5)]);
    assert.ok(plaintextHits(plain, hay).length > 0);
    assert.deepEqual(plaintextHits(plain, randomBytes(8192)), []);
  });

  it("is this user's only", { skip: process.platform === "win32" }, async () => {
    await downloaded();
    assert.equal(statSync(join(rig.root, "mixes")).mode & 0o777, 0o700);
    assert.equal(statSync(join(rig.root, "mixes", ACCT)).mode & 0o777, 0o700);
    assert.equal(statSync(rig.hdrPath(M)).mode & 0o777, 0o600);
    assert.equal(statSync(rig.mixPath(M)).mode & 0o777, 0o600);
  });
});

describe("tampering", () => {
  for (const [name, at] of [
    ["chunk 0", 10],
    ["chunk 1", sealedStart(1) + 5],
    ["the last chunk", sealedStart(2) + 3],
    ["a GCM tag", sealedStart(1) - 1],
    ["the last byte", -1],
  ] as const) {
    it(`of ${name} is detected and the mix deleted`, async () => {
      await downloaded();
      const file = readFileSync(rig.mixPath(M));
      file[at < 0 ? file.length + at : at]! ^= 0x01;
      writeFileSync(rig.mixPath(M), file);
      assert.equal(await anyBad(), true);
      assert.ok(!existsSync(rig.hdrPath(M)) && !existsSync(rig.mixPath(M)));
    });
  }

  it("of the records' order is detected", async () => {
    await downloaded();
    const file = readFileSync(rig.mixPath(M));
    const rec = CHUNK_BYTES + GCM_TAG_BYTES;
    writeFileSync(rig.mixPath(M), Buffer.concat([file.subarray(rec, 2 * rec), file.subarray(0, rec), file.subarray(2 * rec)]));
    assert.equal(await anyBad(), true);
  });

  it("of the file's length is detected, cut or extended", async () => {
    await downloaded();
    truncateSync(rig.mixPath(M), sealedStart(2));
    assert.equal(await anyBad(), true);
    rig.done();
    await downloaded();
    appendFileSync(rig.mixPath(M), Buffer.alloc(16));
    assert.equal(await anyBad(), true);
  });

  it("of the header, any field, is detected", async () => {
    await downloaded();
    const good = readFileSync(rig.hdrPath(M));
    for (const [k, v] of [["usedAt", 1], ["state", "downloading"], ["byteLength", 5], ["sourceVersion", "v2"]] as const) {
      const o = JSON.parse(good.toString());
      o[k] = v;
      writeFileSync(rig.hdrPath(M), JSON.stringify(o));
      assert.equal(rig.cache.open(ACCT, M), null, k);
    }
    writeFileSync(rig.hdrPath(M), good);
    assert.notEqual(rig.cache.open(ACCT, M), null);
  });

  it("a mix copied under another mix's name does not open", async () => {
    await downloaded();
    rig.source.bytes = randomBytes(rig.source.bytes.length);
    assert.equal(await rig.cache.download(ACCT, "mix-2"), "complete");
    // Its whole entry: the header names the other tag.
    copyFileSync(rig.hdrPath(M), rig.hdrPath("mix-2"));
    copyFileSync(rig.mixPath(M), rig.mixPath("mix-2"));
    assert.equal(rig.cache.open(ACCT, "mix-2"), null);
    // Only its data under the other's header: the chunks do not authenticate.
    assert.equal(await rig.cache.download(ACCT, "mix-2"), "complete");
    copyFileSync(rig.mixPath(M), rig.mixPath("mix-2"));
    const r = rig.cache.open(ACCT, "mix-2")!;
    assert.deepEqual(await r.readChunk(0), { ok: false, reason: "bad" });
  });

  it("of a chunk before a resume starts the download over", async () => {
    rig = makeRig();
    rig.source.failAfterBytes = CHUNK_BYTES + 100;
    await rig.cache.download(ACCT, M);
    const id = rig.header(M)!.fileId;
    const file = readFileSync(rig.mixPath(M));
    file[3]! ^= 0x80;
    writeFileSync(rig.mixPath(M), file);
    rig.source.failAfterBytes = null;
    assert.equal(await rig.cache.download(ACCT, M), "complete");
    assert.notEqual(rig.header(M)!.fileId, id);
    assert.deepEqual(await rig.readAll(M), Buffer.from(rig.source.bytes));
  });
});
