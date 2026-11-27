// The phone app's esbuild options, shared by build.mjs and the Bluetooth guard test (issue #686), so the
// test scans the build exactly as it is shipped.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ENTRY_POINTS = ["src/main.ts", "src/rider.ts", "src/instructor.ts", "src/display.ts"];

/**
 * The iOS build setting `swedebeatEnabled` (issue #932), read from the one line that holds it
 * (ios/App/App/Policy/SwedebeatSetting.swift), so native code and the page cannot disagree. Anything but
 * a plain `true` or `false` there stops the build.
 */
export function swedebeatEnabled(swift = readFileSync(join(import.meta.dirname, "ios/App/App/Policy/SwedebeatSetting.swift"), "utf8")) {
  const m = /^\s*static let swedebeatEnabled = (true|false)\s*$/m.exec(swift);
  if (m === null) throw new Error("SwedebeatSetting.swift must hold exactly: static let swedebeatEnabled = true|false");
  return m[1] === "true";
}

export function buildOptions(outdir) {
  return {
    define: { __SWEDEBEAT_ENABLED__: String(swedebeatEnabled()) },
    // One bundle per mode's page (issue #630): rider.js, instructor.js and the room screen's main.js.
    entryPoints: ENTRY_POINTS,
    outdir,
    bundle: true,
    sourcemap: false,
    logLevel: "warning",
    legalComments: "none",
    platform: "browser",
    format: "iife",
    // Android System WebView follows Chrome; the app's minimum (Android 9) updates it from the store.
    target: "chrome130",
    loader: { ".woff2": "file" },
    assetNames: "fonts/[name]",
  };
}
