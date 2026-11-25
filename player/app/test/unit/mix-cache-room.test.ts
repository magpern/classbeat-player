// A download ahead respects the cap (ADR 0013 section 3): a mix that would take the account's cache
// past the cap is refused ("no_room") before a byte is written, so it never pushes another mix out;
// an entry still downloading counts whole. The open class's own download is exempt (the eviction
// tests). Fake source on a temporary folder; no network.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { CHUNK_BYTES } from "../../src/core/mix/cache-crypto.ts";
import { entryBytes } from "../../src/core/mix/cache-header.ts";
import { DAY_MS } from "../../src/core/mix/eviction-policy.ts";
import { ACCT } from "./mix-fakes.ts";
import { makeRig, MIX_BYTES } from "./mix-cache-rig.ts";
import type { Rig } from "./mix-cache-rig.ts";

const SIZE = 100_000;
let rig: Rig;
afterEach(() => rig.done());

async function cached(...ids: string[]): Promise<void> {
  for (const id of ids) {
    rig.clock.now += DAY_MS;
    rig.source.bytes = randomBytes(SIZE);
    assert.equal(await rig.cache.download(ACCT, id), "complete", id);
  }
}
const has = (id: string): boolean => existsSync(rig.hdrPath(id)) || existsSync(rig.mixPath(id));
const present = (...ids: string[]): string[] => ids.filter(has);

describe("a download ahead and the cap", () => {
  it("a mix that would pass the cap is not downloaded, and nothing else goes", async () => {
    rig = makeRig(randomBytes(SIZE), { capBytes: 250_000 });
    await cached("m1", "m2");
    rig.source.bytes = randomBytes(SIZE);
    assert.equal(await rig.cache.download(ACCT, "m3", { keep: ["m1", "m2", "m3"], fit: true }), "no_room");
    assert.deepEqual(present("m1", "m2", "m3"), ["m1", "m2"]);
  });

  it("a mix that fits whole is downloaded and pushes nothing out", async () => {
    rig = makeRig(randomBytes(SIZE), { capBytes: 350_000 });
    await cached("m1", "m2");
    rig.source.bytes = randomBytes(SIZE);
    assert.equal(await rig.cache.download(ACCT, "m3", { keep: ["m1", "m2", "m3"], fit: true }), "complete");
    assert.deepEqual(present("m1", "m2", "m3"), ["m1", "m2", "m3"]);
  });

  it("a mix already cached is complete whatever the room", async () => {
    rig = makeRig(randomBytes(SIZE), { capBytes: 250_000 });
    await cached("m1", "m2");
    // m1 alone leaves less room than m2 takes; m2 is there already.
    rig.rebuild({ capBytes: 150_000 });
    assert.equal(await rig.cache.download(ACCT, "m2", { keep: ["m1", "m2"], fit: true }), "complete");
    // The cache is above its new, lower cap: the older kept mix goes.
    assert.deepEqual(present("m1", "m2"), ["m2"]);
  });

  it("an entry still downloading counts whole", async () => {
    // The open class's mix stopped after one chunk: about a half of it is on disk.
    rig = makeRig(randomBytes(MIX_BYTES), { capBytes: 2 * entryBytes(MIX_BYTES) - 1 });
    rig.source.failAfterBytes = CHUNK_BYTES + 100;
    assert.equal(await rig.cache.download(ACCT, "big1"), "interrupted");
    rig.source.failAfterBytes = null;
    rig.source.bytes = randomBytes(MIX_BYTES);
    assert.equal(await rig.cache.download(ACCT, "big2", { keep: ["big1", "big2"], fit: true }), "no_room");
    assert.deepEqual(present("big1", "big2"), ["big1"]);
    rig.rebuild({ capBytes: 2 * entryBytes(MIX_BYTES) });
    assert.equal(await rig.cache.download(ACCT, "big2", { keep: ["big1", "big2"], fit: true }), "complete");
  });
});
