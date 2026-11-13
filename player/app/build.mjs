// Builds dist/: the shell (main.cjs), the preload script (preload.cjs) and the presenter page.
// Bundled with the pinned esbuild; the class schema and its validator are bundled in, so the
// application never reads the schema from the repository at run time.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

const common = { bundle: true, sourcemap: false, logLevel: "warning", legalComments: "none" };

await Promise.all([
  build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main.cjs", platform: "node", format: "cjs", target: "node22", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/preload/preload.ts"], outfile: "dist/preload.cjs", platform: "node", format: "cjs", target: "node22", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/renderer/presenter.ts"], outfile: "dist/presenter.js", platform: "browser", format: "iife", target: "chrome130" }),
  // The class list: its script, its style (with the design tokens) and the fonts the style names.
  build({ ...common, entryPoints: ["src/renderer/classlist.ts"], outdir: "dist", platform: "browser", format: "iife", target: "chrome130", loader: { ".woff2": "file" }, assetNames: "fonts/[name]" }),
]);
copyFileSync("src/renderer/presenter.html", "dist/presenter.html");
copyFileSync("src/renderer/classlist.html", "dist/classlist.html");
