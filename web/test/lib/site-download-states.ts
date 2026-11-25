// The download page's states on the fake (docs/design/download.md, "States"), for the website
// checks and the flows. The page reads one file of its own bundle; each state scripts that file
// ("GET releases.json", site-releases.ts). Every name, date and checksum is made up: the checksums
// are the SHA-256 of the file names, as in the mock-ups, so they are stable.
import { createHash } from "node:crypto";
import type { Script } from "./site-fake.ts";
import type { State } from "./site-states.ts";
import { RELEASES_KEY } from "./site-releases.ts";

const FILES: readonly (readonly [string, string])[] = [
  ["macOS, Apple silicon", "classbeat-player-macos-arm64-unsigned.tar.gz"],
  ["macOS, Intel", "classbeat-player-macos-x64-unsigned.tar.gz"],
  ["Windows, 64-bit", "classbeat-player-windows-x64-unsigned.tar.gz"],
  ["Linux, 64-bit", "classbeat-player-linux-x64-unsigned.tar.gz"],
];
const RELEASE_PAGE = "https://github.com/example/player/releases/tag/player-v0.1.0";

export const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

export interface AssetOptions {
  readonly signed?: (system: string) => boolean;
  readonly only?: readonly string[];
}

/** The release file's content for a release: `0.1.0` with the four builds of the mock-ups, or fewer. */
export function releaseFile(version = "0.1.0", o: AssetOptions = {}): { readonly release: unknown } {
  const assets = FILES.filter(([system]) => !o.only || o.only.includes(system)).map(([system, file]) => ({
    system,
    file,
    url: `https://github.com/example/player/releases/download/player-v${version}/${file}`,
    sha256: sha(file),
    signed: o.signed?.(system) ?? false,
  }));
  return { release: { version, prerelease: version.includes("-"), date: "2026-11-25", notes_url: RELEASE_PAGE, assets } };
}

const releases = (reply: Script[string]): Script => ({ [RELEASES_KEY]: reply });
const ok = (body: unknown): Script => releases({ status: 200, body });

export const DOWNLOAD_STATES: readonly State[] = [
  { name: "download-found", path: "/download", script: ok(releaseFile()), ready: ".dl-row .btn", main: true },
  // A pre-release that mixes signed and unsigned builds, with one system missing: the notice's other head, the tag, no invented row.
  { name: "download-mixed", path: "/download", script: ok(releaseFile("0.2.0-rc.1", { signed: (s) => s.startsWith("macOS"), only: ["macOS, Apple silicon", "macOS, Intel", "Windows, 64-bit"] })), ready: ".dl-row .btn" },
  // The read held for ever: the loading state, as a slow read leaves it.
  { name: "download-loading", path: "/download", script: releases({ status: 200, hold: true }), ready: ".status" },
  { name: "download-none", path: "/download", script: ok({ release: null }), ready: ".note" },
  // A file that is not there, and a file that is not what the build writes.
  { name: "download-error", path: "/download", script: releases({ status: 404, body: "" }), ready: ".plate" },
  { name: "download-error-shape", path: "/download", script: ok({ release: { version: "0.1.0" } }), ready: ".plate" },
];
