// Builds dist/: the room screen (main.js, main.css, the fonts) and the harness page that runs it
// on recorded snapshots (harness.js), and the website in dist/site/ (index.html, site.js,
// site.css, the fonts). Bundled with the pinned esbuild; nothing is fetched at run time, fonts
// included.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/site", { recursive: true });

const common = {
  bundle: true,
  format: "iife",
  target: "chrome130",
  loader: { ".woff2": "file" },
  assetNames: "fonts/[name]",
  logLevel: "warning",
  legalComments: "none",
};

await build({ ...common, entryPoints: ["src/main.ts", "src/harness.ts"], outdir: "dist" });
copyFileSync("src/harness.html", "dist/harness.html");

// The website: one script and one stylesheet from its own origin, served at the site's root.
await build({ ...common, entryPoints: { site: "src/site/main.ts" }, outdir: "dist/site", publicPath: "/" });
copyFileSync("src/site/index.html", "dist/site/index.html");
