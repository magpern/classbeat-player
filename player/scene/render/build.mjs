// Bundles the demo page into dist/: the page, its script, and the screens lane's tokens.css and
// fonts copied read-only from web/src/design (the scene reads its colours from them).
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const design = join(here, "..", "..", "..", "web", "src", "design");

mkdirSync(join(dist, "design"), { recursive: true });
await build({
  entryPoints: [join(here, "demo", "main.ts")],
  outfile: join(dist, "demo.js"),
  bundle: true, format: "iife", target: "es2022", minify: false, sourcemap: false, logLevel: "warning",
});
cpSync(join(here, "demo", "index.html"), join(dist, "index.html"));
cpSync(join(here, "demo", "demo.css"), join(dist, "demo.css"));
cpSync(join(design, "tokens.css"), join(dist, "design", "tokens.css"));
cpSync(join(design, "fonts"), join(dist, "design", "fonts"), { recursive: true });
