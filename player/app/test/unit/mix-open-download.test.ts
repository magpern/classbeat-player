// The open class's download (main/mix/open-download.ts, ADR 0013 section 3): it starts only on a
// signed-in account, reads its progress at most once a second, maps the cache's outcome to the
// mode policy's readiness, and is started again after RETRY_MS only for a reason that can pass.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MIX_DISABLED } from "../../src/core/mix/view.ts";
import type { MixView } from "../../src/core/mix/view.ts";
import type { CacheOutcome } from "../../src/main/mix/mix-cache.ts";
import type { MixReader } from "../../src/main/mix/mix-reader.ts";
import { openDownload, POLL_MS, RETRY_MS } from "../../src/main/mix/open-download.ts";

const A = "a".repeat(64);
const MIX = { id: "mix_1", lengthMs: 60_000, offsetMs: 0 };

function rig(outcome: CacheOutcome | null = null) {
  let t = 0;
  let view: MixView = { ...MIX_DISABLED, state: "signed_in" };
  let opened = 0;
  let downloads = 0;
  let complete = false;
  const reader = (): MixReader => ({ byteLength: 10, chunks: 4, complete, chunkLength: () => 1, readChunk: () => Promise.resolve({ ok: false, reason: "pending" }), written: () => Promise.resolve(2) });
  const f = openDownload(
    {
      cache: {
        download: () => {
          downloads += 1;
          return outcome === null ? new Promise(() => undefined) : Promise.resolve(outcome);
        },
        open: () => (opened++, reader()),
      },
      view: () => view,
      account: () => A,
      keep: (m) => [m],
      now: () => t,
    },
    MIX,
  );
  return {
    f,
    advance: (ms: number) => (t += ms),
    setView: (v: MixView) => (view = v),
    setComplete: (c: boolean) => (complete = c),
    opened: () => opened,
    downloads: () => downloads,
    flush: () => new Promise((r) => setImmediate(r)),
  };
}

test("not signed in: nothing starts; signed in: it starts once, streaming, and the progress is read once a second", async () => {
  const r = rig();
  r.setView({ ...MIX_DISABLED, state: "signed_out" });
  r.f.tick();
  assert.equal(r.downloads(), 0);
  assert.equal(r.f.account(), null);
  r.setView({ ...MIX_DISABLED, state: "signed_in" });
  r.f.tick();
  r.f.tick();
  assert.equal(r.downloads(), 1);
  assert.equal(r.f.account(), A);
  assert.equal(r.f.readiness(), "streaming");
  assert.equal(r.opened(), 1);
  await r.flush();
  assert.equal(r.f.percent(), 50);
  r.advance(POLL_MS - 1);
  r.f.tick();
  assert.equal(r.opened(), 1);
  r.advance(1);
  r.setComplete(true);
  r.f.tick();
  assert.equal(r.opened(), 2);
  assert.equal(r.f.complete(), true);
  assert.equal(r.f.readiness(), "ready");
  assert.equal(r.f.percent(), 100);
});

test("outcomes: the readiness, and only a passing reason is retried after RETRY_MS", async () => {
  const cases: [CacheOutcome, string, boolean][] = [
    ["complete", "ready", false],
    ["not_allowed", "not_allowed", false],
    ["bad", "not_checked", false],
    ["not_found", "not_checked", false],
    ["too_large", "not_checked", false],
    ["interrupted", "downloading", true],
    ["unavailable", "downloading", true],
    ["token_invalid", "downloading", true],
    ["signed_out", "downloading", true],
    ["no_key", "downloading", true],
  ];
  for (const [o, readiness, again] of cases) {
    const r = rig(o);
    r.f.tick();
    await r.flush();
    assert.equal(r.f.readiness(), readiness, o);
    r.advance(RETRY_MS - 1);
    r.f.tick();
    assert.equal(r.downloads(), 1, o);
    r.advance(1);
    r.f.tick();
    assert.equal(r.downloads(), again ? 2 : 1, o);
  }
});
