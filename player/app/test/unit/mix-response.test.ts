// The answer to one `cbp-mix:` request (main/mix/mix-response.ts): only a GET of a live play, its
// bytes chunk by chunk with one range at most, `no-store`, and a fall back on a missing or bad chunk.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHUNK_BYTES } from "../../src/core/mix/cache-crypto.ts";
import { playUrl } from "../../src/core/mix/scheme-policy.ts";
import { answerMixRequest } from "../../src/main/mix/mix-response.ts";
import type { MixResponseDeps } from "../../src/main/mix/mix-response.ts";
import type { ChunkRead, MixReader } from "../../src/main/mix/mix-reader.ts";
import type { Play } from "../../src/main/mix/plays.ts";

const ID = "1".repeat(32);
const PLAY: Play = { id: ID, webContentsId: 3, account: "a".repeat(64), mixId: "mix_1" };
const LENGTH = CHUNK_BYTES * 2 + 100;
const bytes = Buffer.from(Array.from({ length: LENGTH }, (_, i) => i % 251));

function reader(answer: (i: number) => ChunkRead | "pending" = (i) => ({ ok: true, plain: bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })): MixReader {
  return {
    byteLength: LENGTH,
    chunks: 3,
    complete: false,
    chunkLength: (i) => Math.min(CHUNK_BYTES, LENGTH - i * CHUNK_BYTES),
    readChunk: (i) => {
      const a = answer(i);
      return Promise.resolve(a === "pending" ? { ok: false, reason: "pending" } : a);
    },
    written: () => Promise.resolve(0),
  };
}

function deps(over: Partial<MixResponseDeps> = {}): MixResponseDeps & { faults: string[]; opened: string[] } {
  const faults: string[] = [];
  const opened: string[] = [];
  let t = 0;
  return {
    live: (id) => (id === ID ? PLAY : null),
    open: (a, m) => {
      opened.push(`${a}/${m}`);
      return reader();
    },
    onFault: (id, f) => faults.push(`${id}:${f}`),
    waitMs: 1_000,
    pollMs: 100,
    sleep: (ms) => {
      t += ms;
      return Promise.resolve();
    },
    now: () => t,
    faults,
    opened,
    ...over,
  };
}

const get = (url: string, headers: Record<string, string> = {}, method = "GET"): Request => new Request(url, { method, headers });
const body = async (r: Response): Promise<Buffer> => Buffer.from(await r.arrayBuffer());

test("a live play's whole mix, never stored, naming nothing", async () => {
  const d = deps();
  const r = await answerMixRequest(get(playUrl(ID)), d);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("content-length"), String(LENGTH));
  assert.deepEqual([...r.headers.keys()].sort(), ["accept-ranges", "cache-control", "content-length", "x-content-type-options"]);
  assert.ok((await body(r)).equals(bytes));
  assert.deepEqual(d.opened, [`${PLAY.account}/${PLAY.mixId}`]);
  assert.deepEqual(d.faults, []);
});

test("one byte range across a chunk boundary", async () => {
  const r = await answerMixRequest(get(playUrl(ID), { range: `bytes=${CHUNK_BYTES - 10}-${CHUNK_BYTES + 9}` }), deps());
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), `bytes ${CHUNK_BYTES - 10}-${CHUNK_BYTES + 9}/${LENGTH}`);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok((await body(r)).equals(bytes.subarray(CHUNK_BYTES - 10, CHUNK_BYTES + 10)));
});

test("an unsatisfiable range: 416 with the length only", async () => {
  const r = await answerMixRequest(get(playUrl(ID), { range: "bytes=0-1,4-5" }), deps());
  assert.equal(r.status, 416);
  assert.equal(r.headers.get("content-range"), `bytes */${LENGTH}`);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("not a GET, not a play URL, or a stale or unknown id: an empty answer, nothing opened", async () => {
  const cases: [Request, number][] = [
    [get(playUrl(ID), {}, "POST"), 405],
    [get(playUrl(ID), {}, "HEAD"), 405],
    [get(`${playUrl(ID)}?x=1`), 404],
    [get(`cbp-mix://other/${ID}`), 404],
    [get(playUrl("2".repeat(32))), 404],
  ];
  for (const [req, status] of cases) {
    const d = deps();
    const r = await answerMixRequest(req, d);
    assert.equal(r.status, status, req.url);
    assert.equal((await body(r)).length, 0);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.deepEqual(d.opened, []);
    assert.deepEqual(d.faults, []);
  }
});

test("a mix that is not cached falls back: still downloading", async () => {
  const d = deps({ open: () => null });
  const r = await answerMixRequest(get(playUrl(ID)), d);
  assert.equal(r.status, 404);
  assert.deepEqual(d.faults, [`${ID}:downloading`]);
});

test("a pending chunk is waited for, and played once it is written", async () => {
  let tries = 0;
  const d = deps({ open: () => reader((i) => (i === 1 && tries++ < 3 ? "pending" : { ok: true, plain: bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })) });
  const r = await answerMixRequest(get(playUrl(ID)), d);
  assert.ok((await body(r)).equals(bytes));
  assert.equal(tries, 4);
  assert.deepEqual(d.faults, []);
});

test("a chunk not written within the wait fails the stream once: still downloading", async () => {
  const d = deps({ open: () => reader((i) => (i === 0 ? { ok: true, plain: bytes.subarray(0, CHUNK_BYTES) } : "pending")) });
  const r = await answerMixRequest(get(playUrl(ID)), d);
  await assert.rejects(body(r));
  assert.deepEqual(d.faults, [`${ID}:downloading`]);
});

test("a chunk that fails its check, or an entry gone, fails the stream: not checked, downloading", async () => {
  for (const [reason, fault] of [
    ["bad", "not_checked"],
    ["gone", "downloading"],
  ] as const) {
    const d = deps({ open: () => reader(() => ({ ok: false, reason })) });
    const r = await answerMixRequest(get(playUrl(ID)), d);
    await assert.rejects(body(r));
    assert.deepEqual(d.faults, [`${ID}:${fault}`], reason);
  }
});

test("a play that ends while it streams gets no more bytes", async () => {
  let live = true;
  const d = deps({ live: (id) => (live && id === ID ? PLAY : null) });
  const r = await answerMixRequest(get(playUrl(ID)), d);
  const rd = r.body!.getReader();
  const first = await rd.read();
  assert.equal(first.value?.length, CHUNK_BYTES);
  live = false;
  await assert.rejects(rd.read());
  assert.deepEqual(d.faults, [], "an ended play is not a fault");
});
