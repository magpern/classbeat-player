#!/usr/bin/env node
// Writes the site's release data (issue #793, plan PL7): web/src/site/releases.json, the file the
// download page reads from its own bundle (docs/design/download.md). Pure functions plus a thin
// command line; it makes no network call and reads only the files it is given. The release workflow
// fetches the data (gh api) and passes it in, so tests run on recorded fixtures.
//
//   site-releases-json.mjs tag   <releases.json>                       print the latest release's tag
//   site-releases-json.mjs build <releases.json> <SHA256SUMS> <out>    write the site file
//
// <releases.json> is the GitHub REST list of releases. Anything the page's strict reader
// (web/src/site/core/download-model.ts) would refuse makes `build` fail and write nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const NUM = "(0|[1-9][0-9]*)";
const PRE_ID = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const TAG = new RegExp(`^player-v${NUM}\\.${NUM}\\.${NUM}(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?$`);

/** The systems of the page, in its row order, by the target in the archive's file name. */
const SYSTEMS = [
  { target: "macos-arm64", system: "macOS, Apple silicon" },
  { target: "macos-x64", system: "macOS, Intel" },
  { target: "windows-x64", system: "Windows, 64-bit" },
  { target: "linux-x64", system: "Linux, 64-bit" },
];
const FILE = /^classbeat-player-([a-z0-9]+-[a-z0-9]+)(-unsigned)?\.tar\.gz$/;

/** {core:[a,b,c], pre:[ids]|null} for a `player-v` tag, or null (build metadata is not a release tag here). */
export function parseTag(tag) {
  const m = typeof tag === "string" ? TAG.exec(tag) : null;
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] === undefined ? null : m[4].split(".") };
}

const isNum = (s) => /^[0-9]+$/.test(s);

/** SemVer 2.0.0 precedence: negative, zero or positive. A release with no pre-release part is higher. */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  if (a.pre === null || b.pre === null) return (a.pre === null ? 1 : 0) - (b.pre === null ? 1 : 0);
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === y) continue;
    if (isNum(x) && isNum(y)) return Number(x) - Number(y);
    if (isNum(x) !== isNum(y)) return isNum(x) ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return a.pre.length - b.pre.length;
}

/** The latest release: published (not a draft), a `player-v` tag, highest SemVer, stable before any pre-release. */
export function latestRelease(releases) {
  if (!Array.isArray(releases)) throw new Error("the release list is not a list");
  let best = null;
  for (const r of releases) {
    if (typeof r !== "object" || r === null || r.draft === true) continue;
    const v = parseTag(r.tag_name);
    if (v === null) continue;
    // A stable release wins over any pre-release (docs/design/download.md), even a higher one.
    const stable = (x) => (x.pre === null ? 1 : 0);
    if (best === null || stable(v) - stable(best.v) > 0 || (stable(v) === stable(best.v) && compareVersions(v, best.v) > 0)) best = { r, v };
  }
  return best === null ? null : best.r;
}

/** Map of file to sha256 from the text of SHA256SUMS (sha256sum format). Any other line is an error. */
export function parseSums(text) {
  const sums = new Map();
  for (const line of String(text).split("\n")) {
    if (line === "") continue;
    const m = /^([0-9a-f]{64}) [ *]([A-Za-z0-9._-]{1,120})$/.exec(line);
    if (!m) throw new Error(`SHA256SUMS has a line that is not "<sha256>  <file>": ${line.slice(0, 80)}`);
    if (sums.has(m[2])) throw new Error(`SHA256SUMS lists ${m[2]} twice`);
    sums.set(m[2], m[1]);
  }
  if (sums.size === 0) throw new Error("SHA256SUMS lists no file");
  return sums;
}

function githubUrl(u, what) {
  let url;
  try {
    url = new URL(u);
  } catch {
    throw new Error(`${what} is not an address`);
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port !== "" || url.username !== "" || url.password !== "") {
    throw new Error(`${what} is not an https address on github.com`);
  }
  return u;
}

/** The site file's value, from the list of releases and the latest release's SHA256SUMS text. */
export function buildSiteData(releases, sumsText) {
  const release = latestRelease(releases);
  if (release === null) return { release: null };
  const tag = parseTag(release.tag_name);
  const sums = parseSums(sumsText);
  const published = new Map();
  for (const a of Array.isArray(release.assets) ? release.assets : []) {
    if (a && typeof a.name === "string") published.set(a.name, a.browser_download_url);
  }
  const rows = new Map();
  for (const [file, sha256] of sums) {
    const m = FILE.exec(file);
    const row = m && SYSTEMS.find((s) => s.target === m[1]);
    if (!row) throw new Error(`SHA256SUMS lists a file that is not a player archive: ${file}`);
    if (rows.has(row.system)) throw new Error(`SHA256SUMS lists two archives for ${row.system}`);
    if (!published.has(file)) throw new Error(`${file} is in SHA256SUMS but not among the release's files`);
    rows.set(row.system, {
      system: row.system,
      file,
      url: githubUrl(published.get(file), `the address of ${file}`),
      sha256,
      signed: m[2] === undefined,
    });
  }
  const date = typeof release.published_at === "string" ? release.published_at.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("the release has no published date");
  return {
    release: {
      version: release.tag_name.slice("player-v".length),
      prerelease: tag.pre !== null,
      date,
      notes_url: githubUrl(release.html_url, "the release's page"),
      // The page's own order, never the order of SHA256SUMS.
      assets: SYSTEMS.map((s) => rows.get(s.system)).filter((a) => a !== undefined),
    },
  };
}

const read = (p) => readFileSync(p, "utf8");

function main(argv) {
  const [cmd, ...args] = argv;
  if (cmd === "tag" && args.length === 1) {
    const r = latestRelease(JSON.parse(read(args[0])));
    if (r !== null) process.stdout.write(`${r.tag_name}\n`);
    return;
  }
  if (cmd === "build" && args.length === 3) {
    const data = buildSiteData(JSON.parse(read(args[0])), read(args[1]));
    writeFileSync(args[2], `${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  throw new Error("usage: site-releases-json.mjs tag <releases.json> | build <releases.json> <SHA256SUMS> <out>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`site-releases-json: ${e.message}\n`);
    process.exit(1);
  }
}
