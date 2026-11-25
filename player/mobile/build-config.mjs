// The phone app's esbuild options, shared by build.mjs and the Bluetooth guard test (issue #686), so the
// test scans the build exactly as it is shipped.
export const ENTRY_POINTS = ["src/main.ts", "src/rider.ts", "src/instructor.ts", "src/display.ts"];

export function buildOptions(outdir) {
  return {
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
