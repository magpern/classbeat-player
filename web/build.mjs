// Builds dist/: the room screen (main.js, main.css, the fonts) and the harness page that runs it
// on recorded snapshots (harness.js). Bundled with the pinned esbuild; nothing is fetched at run
// time, fonts included.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

await build({
  entryPoints: ["src/main.ts", "src/harness.ts"],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome130",
  loader: { ".woff2": "file" },
  assetNames: "fonts/[name]",
  logLevel: "warning",
  legalComments: "none",
});
copyFileSync("src/harness.html", "dist/harness.html");
