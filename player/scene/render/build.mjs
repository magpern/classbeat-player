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
// The join's quality run (tools/join-quality-shots.ts): the room window's real mount on a page with a hand-driven clock.
await build({
  entryPoints: [join(here, "tools", "join-quality-page.ts")],
  outfile: join(dist, "join-quality.js"),
  bundle: true, format: "iife", target: "es2022", minify: false, sourcemap: false, logLevel: "warning",
});
cpSync(join(here, "tools", "join-quality.html"), join(dist, "join-quality.html"));
cpSync(join(here, "demo", "index.html"), join(dist, "index.html"));
cpSync(join(here, "demo", "demo.css"), join(dist, "demo.css"));
cpSync(join(here, "layer", "text.css"), join(dist, "text.css"));
cpSync(join(design, "tokens.css"), join(dist, "design", "tokens.css"));
cpSync(join(design, "fonts"), join(dist, "design", "fonts"), { recursive: true });
