// Builds the page the app carries into android/app/src/main/assets/public/ (issue #627): the room
// screen and the fake room (src/main.ts) as one script, its style and fonts, and index.html with
// the desktop room screen's Content Security Policy (src/page.ts). The Capacitor CLI is not used:
// capacitor.config.json and capacitor.plugins.json are committed in the assets folder as they are
// shipped, so no tool rewrites the locked config. Run with tsx (npm run build) to read page.ts.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { indexHtml } from "./src/page.ts";

const out = "android/app/src/main/assets/public";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ["src/main.ts"],
  outdir: out,
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
});
writeFileSync(`${out}/index.html`, indexHtml());
