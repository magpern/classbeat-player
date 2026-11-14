// Builds dist/: the room screen (main.js, main.css, the fonts) and the harness page that runs it
// on recorded snapshots (harness.js), the website in dist/site/ (index.html, site.js, site.css,
// the fonts), the web player page in dist/site/play/ (index.html, play.js, three stylesheets, its
// fonts), served at /play, and the handlebar companion page in dist/control/ (index.html, companion.js,
// companion.css, its fonts), served at /control, and the rider page in dist/j/ (index.html,
// rider.js, rider.css, its fonts), served at /j. Bundled with the pinned esbuild; nothing is
// fetched at run time, fonts included.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/site/play", { recursive: true });

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

// The web player page (ADR 0008): its own script, three stylesheets (the always-on tokens, the picker's
// and the room screen's, which index.html switches between) and the fonts under /play/ in the site's
// output, served wherever and however dist/site/ is. Fonts load from its own origin, nothing else.
await build({
  ...common,
  entryPoints: { play: "src/play/main.ts", base: "src/play/base.css", page: "src/play/page.css", room: "src/play/room.css" },
  outdir: "dist/site/play",
  publicPath: "/play/",
});
copyFileSync("src/play/index.html", "dist/site/play/index.html");

// The handlebar companion: its own script and stylesheet under /control/, fonts beside them.
await build({ ...common, entryPoints: { companion: "src/companion/main.ts" }, outdir: "dist/control" });
copyFileSync("src/companion/index.html", "dist/control/index.html");

// The rider page: its own script and stylesheet under /j/, fonts beside them.
await build({ ...common, entryPoints: { rider: "src/rider/main.ts" }, outdir: "dist/j" });
copyFileSync("src/rider/index.html", "dist/j/index.html");
