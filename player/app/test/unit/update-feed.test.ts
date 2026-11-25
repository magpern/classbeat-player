// Reading the release feed's reply and picking the latest per channel (ADR 0014, section 1;
// issue #797), on recorded replies in test/fixtures/updates/.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { latestIn, MAX_RELEASES, readFeed, versionOfTag } from "../../src/core/update/feed.ts";
import type { FeedResult } from "../../src/core/update/feed.ts";
import { REPO } from "./fixtures.ts";

const DIR = join(REPO, "player", "app", "test", "fixtures", "updates");
const reply = (name: string): string => readFileSync(join(DIR, name), "utf8");
const versions = (r: FeedResult): string[] => (r.ok ? r.releases.map((x) => x.version.text) : assert.fail("could not check"));
const latest = (r: FeedResult, pre: boolean): string | null => (r.ok ? (latestIn(r.releases, pre)?.text ?? null) : assert.fail("could not check"));
const entry = (tag: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ tag_name: tag, draft: false, prerelease: false, published_at: "2026-11-01T10:00:00Z", ...over });

test("only published player releases with a SemVer tag are kept, highest first", () => {
  // Left out: the draft 2.0.0, the unpublished 6.0.0, the foreign v9 and backend-v8 tags, the wrong
  // case prefix, and 7.0, 07.0.0, 7.0.0/../x and 7.0.0?a=b, which are not SemVer.
  assert.deepEqual(versions(readFeed(reply("releases.json"))), ["1.3.0-rc.1", "1.2.1", "1.2.0", "1.1.0"]);
});

test("a pre-release is a tag with a hyphen part; the API's prerelease flag is ignored", () => {
  const r = readFeed(reply("releases.json"));
  const flags = r.ok ? r.releases.map((x) => [x.version.text, x.prerelease]) : [];
  // 1.3.0-rc.1 is flagged false and 1.2.1 is flagged true in the reply.
  assert.deepEqual(flags, [["1.3.0-rc.1", true], ["1.2.1", false], ["1.2.0", false], ["1.1.0", false]]);
});

test("the latest per channel honours the pre-releases setting", () => {
  const cases: [string, boolean, string | null][] = [
    ["releases.json", false, "1.2.1"],
    ["releases.json", true, "1.3.0-rc.1"],
    ["prerelease-only.json", false, null], // with pre-releases off and no stable release: none
    ["prerelease-only.json", true, "1.0.0-beta.10"], // numeric order, not text order; the 1.0.0 draft is out
    ["empty.json", false, null],
    ["empty.json", true, null],
  ];
  for (const [name, pre, want] of cases) assert.equal(latest(readFeed(reply(name)), pre), want, `${name} pre=${pre}`);
});

test("a stable release beats the pre-releases of its own version", () => {
  const r = readFeed(JSON.stringify([entry("player-v2.0.0-rc.2"), entry("player-v2.0.0"), entry("player-v2.0.0-rc.10")]));
  assert.equal(latest(r, true), "2.0.0");
});

test("a malformed or wrong-shape reply is 'could not check' as a whole, never a partial result", () => {
  for (const name of ["not-json.html", "truncated.json", "not-array.json", "wrong-shape.json"]) {
    assert.deepEqual(readFeed(reply(name)), { ok: false }, name);
  }
  const bad: unknown[] = [
    undefined, null, 42, "", "null", "{}", "\"player-v1.0.0\"", "[null]", "[1]", "[[]]", "[\"player-v1.0.0\"]",
    JSON.stringify([entry("player-v1.0.0"), { draft: false, published_at: null }]), // no tag
    JSON.stringify([entry("player-v1.0.0"), entry("player-v1.1.0", { tag_name: 110 })]),
    JSON.stringify([entry("player-v1.0.0"), entry("player-v1.1.0", { draft: undefined })]),
    JSON.stringify([entry("player-v1.0.0"), entry("player-v1.1.0", { draft: 0 })]),
    JSON.stringify([entry("player-v1.0.0"), entry("player-v1.1.0", { published_at: 1_700_000_000 })]),
    JSON.stringify(Array.from({ length: MAX_RELEASES + 1 }, (_, i) => entry(`player-v1.0.${i}`))),
  ];
  for (const body of bad) assert.deepEqual(readFeed(body), { ok: false }, String(body));
});

test("a full page of releases is read", () => {
  const r = readFeed(JSON.stringify(Array.from({ length: MAX_RELEASES }, (_, i) => entry(`player-v1.0.${i}`))));
  assert.equal(latest(r, false), `1.0.${MAX_RELEASES - 1}`);
});

test("drafts and unpublished releases are left out even when they are the highest", () => {
  const r = readFeed(JSON.stringify([entry("player-v1.0.0"), entry("player-v3.0.0", { draft: true }), entry("player-v2.0.0", { published_at: null }), entry("player-v2.1.0", { published_at: "" })]));
  assert.deepEqual(versions(r), ["1.0.0"]);
});

test("a tag names a player version only as player-v followed by SemVer", () => {
  const cases: [string, string | null][] = [
    ["player-v1.2.3", "1.2.3"],
    ["player-v1.2.3-rc.1", "1.2.3-rc.1"],
    ["player-1.2.3", null],
    ["player-v", null],
    ["v1.2.3", null],
    ["xplayer-v1.2.3", null],
    ["player-vv1.2.3", null],
    ["player-v1.2.3 ", null],
    ["player-v1.2.3/../x", null],
    ["player-v1.2.3?a=b", null],
  ];
  for (const [tag, want] of cases) assert.equal(versionOfTag(tag)?.text ?? null, want, tag);
});
