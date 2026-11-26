// npm run ios:verify (issue #894, criterion 5): on macOS, after the CI job's xcodebuild, Apple's
// own readers check the built app and the project against the shared allowlists. It runs the
// self-test first (planted temp files must each give a finding), then the real check; with
// --self-test it runs the self-test alone. It exits non-zero on any finding, outside macOS, and
// when $IOS_DERIVED_DATA or the built app is missing, so the job cannot pass without checking.
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Json } from "./allowlists.ts";
import { selfTest, type Tools, verifyBuild } from "./verify.ts";

const MOBILE = join(fileURLToPath(import.meta.url), "..", "..");
const PROJECT = join(MOBILE, "ios", "App", "App.xcodeproj", "project.pbxproj");

const plutil = (args: string[], input?: string): string =>
  execFileSync("/usr/bin/plutil", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 << 20 });

const apple: Tools = {
  plistJson: (path) => JSON.parse(plutil(["-convert", "json", "-o", "-", "--", path])) as Json,
  signedEntitlements(app) {
    const r = spawnSync("/usr/bin/codesign", ["-d", "--entitlements", ":-", app], { encoding: "utf8" });
    if (r.status !== 0) {
      if (/not signed at all/.test(r.stderr)) return undefined;
      throw new Error(`codesign could not read the app: ${r.stderr.trim()}`);
    }
    if (r.stdout.trim() === "") return {};
    return JSON.parse(plutil(["-convert", "json", "-o", "-", "-"], r.stdout)) as Json;
  },
};

function main(argv: string[]): number {
  if (process.platform !== "darwin") {
    console.error("ios:verify runs on macOS only, where Apple's plutil and codesign are");
    return 2;
  }
  const failed = selfTest(PROJECT, apple);
  for (const f of failed) console.error(`self-test: ${f}`);
  if (failed.length > 0) return 1;
  console.log("ios:verify self-test passed");
  if (argv.includes("--self-test")) return 0;
  const derived = process.env["IOS_DERIVED_DATA"];
  if (!derived) {
    console.error("IOS_DERIVED_DATA is not set: there is no built app to check");
    return 1;
  }
  const found = verifyBuild(derived, PROJECT, apple);
  for (const f of found) console.error(f);
  if (found.length > 0) return 1;
  console.log("ios:verify: the built app and the project hold every allowlist");
  return 0;
}

process.exitCode = main(process.argv.slice(2));
