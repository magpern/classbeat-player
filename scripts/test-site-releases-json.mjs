// Tests scripts/site-releases-json.mjs (issue #793) offline on recorded fixtures in
// scripts/fixtures/site-releases/, and feeds its output through the download page's strict reader
// (web/src/site/core/download-model.ts, loaded by Node's own type stripping, Node 22.18 or later).
// No network. Run: node --test scripts/test-site-releases-json.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readingOf } from "../web/src/site/core/download-model.ts";
import { buildSiteData, compareVersions, latestRelease, parseTag } from "./site-releases-json.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const fx = (name) => join(here, "fixtures", "site-releases", name);
const json = (name) => JSON.parse(readFileSync(fx(name), "utf8"));
const text = (name) => readFileSync(fx(name), "utf8");
const script = join(here, "site-releases-json.mjs");

/** Builds through the command line into a temp file and returns what the page would read. */
function cli(releases, sums) {
  const dir = mkdtempSync(join(tmpdir(), "site-releases-"));
  try {
    const out = join(dir, "releases.json");
    execFileSync("node", [script, "build", fx(releases), fx(sums), out], { stdio: "pipe" });
    return readFileSync(out, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a stable release: highest SemVer, drafts, other tags and pre-releases are passed over", () => {
  const out = cli("releases-stable.json", "sums-full");
  const reading = readingOf(out);
  assert.equal(reading.kind, "found");
  const r = reading.release;
  assert.equal(r.version, "0.1.0");
  assert.equal(r.prerelease, false);
  assert.equal(r.date, "2026-11-25");
  assert.equal(r.notes_url, "https://github.com/magpern/classbeat-player/releases/tag/player-v0.1.0");
  assert.deepEqual(
    r.assets.map((a) => a.system),
    ["macOS, Apple silicon", "macOS, Intel", "Windows, 64-bit", "Linux, 64-bit"],
  );
  assert.ok(r.assets.every((a) => !a.signed));
  const linux = r.assets[3];
  assert.equal(linux.file, "classbeat-player-linux-x64-unsigned.tar.gz");
  assert.equal(linux.url, "https://github.com/magpern/classbeat-player/releases/download/player-v0.1.0/classbeat-player-linux-x64-unsigned.tar.gz");
  assert.equal(linux.sha256, text("sums-full").split("\n")[0].split("  ")[0]);
  assert.ok(out.endsWith("}\n"));
});

test("only pre-releases: the highest by SemVer, marked (rc.10 above rc.2 above beta)", () => {
  const releases = json("releases-prerelease.json");
  // rc.10 above rc.2 (numeric), and rc above beta only because "rc" sorts after "beta".
  assert.equal(latestRelease(releases).tag_name, "player-v0.2.0-rc.10");
  const data = buildSiteData(releases, text("sums-full"));
  assert.equal(data.release.version, "0.2.0-rc.10");
  assert.equal(data.release.prerelease, true);
  assert.equal(readingOf(JSON.stringify(data)).kind, "found");
});

test("a half release lists only the systems it has, in the page's order", () => {
  const reading = readingOf(cli("releases-half.json", "sums-half"));
  assert.equal(reading.kind, "found");
  assert.deepEqual(
    reading.release.assets.map((a) => a.system),
    ["Windows, 64-bit", "Linux, 64-bit"],
  );
});

test("mixed signing: a file name without -unsigned is signed, the others are not", () => {
  const reading = readingOf(cli("releases-mixed.json", "sums-mixed"));
  assert.equal(reading.kind, "found");
  const signed = Object.fromEntries(reading.release.assets.map((a) => [a.system, a.signed]));
  assert.deepEqual(signed, {
    "macOS, Apple silicon": true,
    "macOS, Intel": false,
    "Windows, 64-bit": false,
    "Linux, 64-bit": false,
  });
});

test("no published player release: the page's own 'none' file", () => {
  const out = cli("releases-none.json", "sums-full");
  assert.deepEqual(JSON.parse(out), { release: null });
  assert.equal(readingOf(out).kind, "none");
});

test("a malformed SHA256SUMS fails the build and writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "site-releases-"));
  try {
    const out = join(dir, "releases.json");
    const r = spawnSync("node", [script, "build", fx("releases-stable.json"), fx("sums-malformed"), out], { encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /SHA256SUMS/);
    assert.throws(() => readFileSync(out), { code: "ENOENT" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sums file that disagrees with the release is refused", () => {
  // A line for a file the release does not hold, a duplicate, a short checksum, an unknown archive.
  const releases = json("releases-half.json");
  const sha = "a".repeat(64);
  const bad = [
    `${sha}  classbeat-player-macos-x64-unsigned.tar.gz\n`,
    `${sha}  classbeat-player-linux-x64-unsigned.tar.gz\n${sha}  classbeat-player-linux-x64-unsigned.tar.gz\n`,
    "abc  classbeat-player-linux-x64-unsigned.tar.gz\n",
    `${sha}  classbeat-player-freebsd-x64-unsigned.tar.gz\n`,
    `${sha.toUpperCase()}  classbeat-player-linux-x64-unsigned.tar.gz\n`,
    "",
  ];
  for (const sums of bad) assert.throws(() => buildSiteData(releases, sums), Error, JSON.stringify(sums));
});

test("an address off github.com is refused", () => {
  const releases = json("releases-half.json");
  releases[0].assets[0].browser_download_url = "https://example.com/x.tar.gz";
  assert.throws(() => buildSiteData(releases, text("sums-half")), /github\.com/);
});

test("the tag command prints the latest tag, and nothing when there is none", () => {
  const run = (f) => execFileSync("node", [script, "tag", fx(f)], { encoding: "utf8" });
  assert.equal(run("releases-stable.json"), "player-v0.1.0\n");
  assert.equal(run("releases-none.json"), "");
});

test("SemVer precedence and the player-v rule", () => {
  const v = (t) => parseTag(`player-v${t}`);
  assert.ok(compareVersions(v("1.0.0"), v("1.0.0-rc.1")) > 0);
  assert.ok(compareVersions(v("1.0.0-rc.1"), v("1.0.0-alpha")) > 0);
  assert.ok(compareVersions(v("1.0.0-1"), v("1.0.0-alpha")) < 0);
  assert.ok(compareVersions(v("1.0.0-rc"), v("1.0.0-rc.1")) < 0);
  assert.ok(compareVersions(v("1.10.0"), v("1.9.0")) > 0);
  assert.equal(parseTag("v1.0.0"), null);
  assert.equal(parseTag("player-v01.0.0"), null);
  assert.equal(parseTag("player-v1.0"), null);
  assert.equal(parseTag("player-v1.0.0+build"), null);
});
