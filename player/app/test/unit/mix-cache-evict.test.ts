// Eviction in the encrypted mix cache (ADR 0013 section 3), on a fake clock: above the cap the least
// recently played mix goes first, never one kept for the class playing or starting soon; a mix not
// played for 90 days and one no class names go; leftovers and unreadable entries go; other accounts
// are never touched.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { DAY_MS } from "../../src/core/mix/eviction-policy.ts";
import { ACCT, OTHER } from "./mix-fakes.ts";
import { FAKE_TOKEN } from "./fake-mix-source.ts";
import { makeRig } from "./mix-cache-rig.ts";
import type { Rig } from "./mix-cache-rig.ts";

const SIZE = 100_000; // one chunk each; about 100 KB on disk
let rig: Rig;
afterEach(() => rig.done());

/** Downloads each mix one day apart, each with its own bytes. */
async function cached(...ids: string[]): Promise<void> {
  for (const id of ids) {
    rig.clock.now += DAY_MS;
    rig.source.bytes = randomBytes(SIZE);
    assert.equal(await rig.cache.download(ACCT, id), "complete", id);
  }
}
const has = (id: string, a = ACCT): boolean => existsSync(rig.hdrPath(id, a)) || existsSync(rig.mixPath(id, a));
const present = (...ids: string[]): string[] => ids.filter((id) => has(id));

describe("eviction above the cap", () => {
  it("deletes the least recently played after a download, keeping the new one", async () => {
    rig = makeRig(randomBytes(SIZE), { capBytes: 350_000 });
    await cached("m1", "m2", "m3");
    rig.clock.now += DAY_MS;
    rig.cache.played(ACCT, "m1");
    await cached("m4");
    assert.deepEqual(present("m1", "m2", "m3", "m4"), ["m1", "m3", "m4"]);
    await cached("m5");
    assert.deepEqual(present("m1", "m3", "m4", "m5"), ["m1", "m4", "m5"]);
  });

  it("never deletes a mix kept for the class playing or starting soon", async () => {
    rig = makeRig(randomBytes(SIZE), { capBytes: 250_000 });
    await cached("m1", "m2");
    rig.clock.now += DAY_MS;
    rig.source.bytes = randomBytes(SIZE);
    assert.equal(await rig.cache.download(ACCT, "m3", ["m1"]), "complete");
    assert.deepEqual(present("m1", "m2", "m3"), ["m1", "m3"]);
    // Kept above the cap: nothing kept is deleted, however full.
    assert.equal(await rig.cache.evict(ACCT, { keep: ["m1", "m3"] }), 0);
    rig.rebuild({ capBytes: 1 });
    assert.equal(await rig.cache.evict(ACCT, { keep: ["m1", "m3"] }), 0);
    assert.equal(await rig.cache.evict(ACCT, { keep: ["m3"] }), 1);
    assert.deepEqual(present("m1", "m3"), ["m3"]);
  });
});

describe("expiry and leftovers", () => {
  it("deletes a mix not played for 90 days, unless kept", async () => {
    rig = makeRig(randomBytes(SIZE));
    await cached("m1", "m2", "m3");
    rig.clock.now += 87 * DAY_MS; // m1 is 89 days old
    rig.cache.played(ACCT, "m3");
    assert.equal(await rig.cache.evict(ACCT, { keep: [] }), 0);
    rig.clock.now += 2 * DAY_MS;
    assert.equal(await rig.cache.evict(ACCT, { keep: ["m1"] }), 1);
    assert.deepEqual(present("m1", "m2", "m3"), ["m1", "m3"]);
  });

  it("deletes a mix no class names any more", async () => {
    rig = makeRig(randomBytes(SIZE));
    await cached("m1", "m2");
    assert.equal(await rig.cache.evict(ACCT, { keep: [], named: ["m2"] }), 1);
    assert.deepEqual(present("m1", "m2"), ["m2"]);
  });

  it("deletes stray files and entries whose header does not verify", async () => {
    rig = makeRig(randomBytes(SIZE));
    await cached("m1", "m2");
    const dir = join(rig.root, "mixes", ACCT);
    writeFileSync(join(dir, "leftover.tmp"), "x");
    mkdirSync(join(dir, "planted"));
    writeFileSync(rig.hdrPath("m2"), "{}");
    assert.equal(await rig.cache.evict(ACCT, { keep: [] }), 1);
    assert.ok(!existsSync(join(dir, "leftover.tmp")) && !existsSync(join(dir, "planted")));
    assert.deepEqual(present("m1", "m2"), ["m1"]);
  });

  it("touches no other account", async () => {
    rig = makeRig(randomBytes(SIZE));
    rig.vault.saveToken(OTHER, FAKE_TOKEN);
    assert.equal(await rig.cache.download(OTHER, "m1"), "complete");
    await cached("m1");
    rig.clock.now += 365 * DAY_MS;
    assert.equal(await rig.cache.evict(ACCT, { keep: [] }), 1);
    assert.ok(has("m1", OTHER));
    assert.equal(await rig.cache.evict(OTHER, { keep: [], named: [] }), 1);
  });
});
