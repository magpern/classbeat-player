// The download page's data and words (src/site/core/download-model.ts) and the guard that the page
// makes no call but the read of its own bundle's file. No browser, no network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkLines, checksumGroups, dateWords, readingOf, unsignedHead, UNSIGNED_LINES } from "../../src/site/core/download-model.ts";
import type { Asset } from "../../src/site/core/download-model.ts";
import { releaseFile, sha } from "../lib/site-download-states.ts";
import { pageOf, returnPathOf } from "../../src/site/core/routes.ts";

const WEB = join(import.meta.dirname, "..", "..");
const text = (v: unknown): string => JSON.stringify(v);

describe("readingOf", () => {
  it("reads a release as found, with its builds in the file's order", () => {
    const r = readingOf(text(releaseFile()));
    assert.equal(r.kind, "found");
    if (r.kind !== "found") return;
    assert.equal(r.release.version, "0.1.0");
    assert.deepEqual(r.release.assets.map((a) => a.system), ["macOS, Apple silicon", "macOS, Intel", "Windows, 64-bit", "Linux, 64-bit"]);
  });

  it("reads `release: null` as none, and the file the build copies today is that", () => {
    assert.deepEqual(readingOf('{"release":null}'), { kind: "none" });
    assert.deepEqual(readingOf(readFileSync(join(WEB, "src", "site", "releases.json"), "utf8")), { kind: "none" });
  });

  it("reads anything else as unreadable", () => {
    const good = releaseFile().release as Record<string, unknown>;
    const asset = (good.assets as Record<string, unknown>[])[0];
    const withRelease = (patch: Record<string, unknown>): string => text({ release: { ...good, ...patch } });
    const withAsset = (patch: Record<string, unknown>): string => withRelease({ assets: [{ ...asset, ...patch }] });
    const bad: [string, string][] = [
      ["empty", ""],
      ["not JSON", "<html>"],
      ["a string", '"x"'],
      ["a list", "[]"],
      ["no release key", "{}"],
      ["release is a string", '{"release":"0.1.0"}'],
      ["no assets", withRelease({ assets: [] })],
      ["assets not a list", withRelease({ assets: {} })],
      ["version with a prefix", withRelease({ version: "player-v0.1.0" })],
      ["version two parts", withRelease({ version: "0.1" })],
      ["prerelease not a boolean", withRelease({ prerelease: "no" })],
      ["date with a time", withRelease({ date: "2026-11-25T10:00:00Z" })],
      ["date that is not one", withRelease({ date: "2026-02-30" })],
      ["notes address on another host", withRelease({ notes_url: "https://example.com/x" })],
      ["notes address not https", withRelease({ notes_url: "http://github.com/x" })],
      ["notes address a script", withRelease({ notes_url: "javascript:alert(1)" })],
      ["notes address with a sign-in part", withRelease({ notes_url: "https://a:b@github.com/x" })],
      ["asset address on another host", withAsset({ url: "https://github.com.example.com/x" })],
      ["asset address relative", withAsset({ url: "/x" })],
      ["checksum short", withAsset({ sha256: "ab" })],
      ["checksum upper case", withAsset({ sha256: "A".repeat(64) })],
      ["checksum not hex", withAsset({ sha256: "g".repeat(64) })],
      ["file with a slash", withAsset({ file: "../x.tar.gz" })],
      ["file with markup", withAsset({ file: "<b>.tar.gz" })],
      ["system with markup", withAsset({ system: "<b>macOS" })],
      ["signed not a boolean", withAsset({ signed: "yes" })],
      ["the same system twice", withRelease({ assets: [asset, asset] })],
    ];
    for (const [what, body] of bad) assert.deepEqual(readingOf(body), { kind: "unreadable" }, what);
  });
});

describe("words", () => {
  it("words a date without a clock or time zone, and refuses a date that is not one", () => {
    assert.equal(dateWords("2026-11-25"), "25 Nov 2026");
    assert.equal(dateWords("2026-01-05"), "5 Jan 2026");
    assert.equal(dateWords("2028-02-29"), "29 Feb 2028");
    for (const bad of ["2026-02-29", "2100-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-4-3", "", "x"]) assert.equal(dateWords(bad), "", bad);
  });

  it("cuts a checksum into eight groups of eight in two halves, which joined are the 64 characters", () => {
    const sum = sha("a");
    const halves = checksumGroups(sum);
    assert.deepEqual(halves.map((h) => h.length), [4, 4]);
    assert.ok(halves.flat().every((g) => g.length === 8));
    assert.equal(halves.flat().join(""), sum);
  });

  it("names the notice from the builds: none when all are signed, 'These' for all unsigned, 'Some' for a mix", () => {
    const a = (signed: boolean): Asset => ({ system: "x", file: "f", url: "u", sha256: sha("f"), signed });
    assert.equal(unsignedHead([a(true), a(true)]), null);
    assert.equal(unsignedHead([a(false), a(false)]), "These builds are unsigned");
    assert.equal(unsignedHead([a(true), a(false)]), "Some builds are unsigned");
  });

  it("has only the spec's first sentence for the notice while the owner's wording is missing", () => {
    assert.deepEqual(UNSIGNED_LINES, ["macOS and Windows will warn you when you open them."]);
  });

  it("gives a check line only for a family the release has", () => {
    const a = (system: string): Asset => ({ system, file: "f", url: "u", sha256: sha("f"), signed: false });
    assert.deepEqual(checkLines([a("Windows, 64-bit")]).map((l) => l.family), ["Windows"]);
    assert.deepEqual(checkLines([a("Linux, 64-bit")]).map((l) => l.family), ["macOS and Linux"]);
    assert.deepEqual(checkLines([a("macOS, Intel"), a("Windows, 64-bit")]).map((l) => l.family), ["macOS and Linux", "Windows"]);
    assert.deepEqual(checkLines([]), []);
  });
});

describe("the address", () => {
  it("is a public page of its own, and never an address a sign-in returns to", () => {
    assert.deepEqual(pageOf("/download"), { kind: "download" });
    assert.deepEqual(pageOf("/download/"), { kind: "not-found" });
    assert.equal(returnPathOf("/download", ""), null);
  });
});

describe("the page makes no call but the read of its own bundle's file", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  const sources = files(join(WEB, "src", "site")).filter((f) => f.endsWith(".ts"));

  it("fetches only in the API module and the release read, and the release read asks for a path of this site", () => {
    const fetching = sources.filter((f) => /\bfetch\s*\(/.test(readFileSync(f, "utf8"))).map((f) => relative(WEB, f).replaceAll("\\", "/")).sort();
    assert.deepEqual(fetching, ["src/site/net/api.ts", "src/site/net/releases.ts"]);
    const read = readFileSync(join(WEB, "src", "site", "net", "releases.ts"), "utf8");
    assert.match(read, /RELEASES_FILE = "\/releases\.json"/);
    assert.match(read, /fetch\(RELEASES_FILE,/);
  });

  it("holds no address with a scheme in the download page's own sources", () => {
    for (const f of ["core/download-model.ts", "pages/download.ts", "pages/download-rows.ts", "net/releases.ts"]) {
      const code = readFileSync(join(WEB, "src", "site", f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      assert.doesNotMatch(code, /https?:\/\/|wss?:\/\//, f);
    }
  });
});
