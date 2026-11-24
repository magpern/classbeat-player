// Builds the pages the app carries into android/app/src/main/assets/public/ (issues #627, #630): the
// room screen and the fake room (src/main.ts, room.html), each mode's start page (src/rider.ts,
// src/instructor.ts), their styles and fonts, and the HTML with the desktop room screen's Content
// Security Policy (src/page.ts). The Capacitor CLI is not used:
// capacitor.config.json and capacitor.plugins.json are committed in the assets folder as they are
// shipped, so no tool rewrites the locked config. Run with tsx (npm run build) to read page.ts.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { buildOptions } from "./build-config.mjs";
import { PAGES, pageHtml } from "./src/page.ts";

const out = "android/app/src/main/assets/public";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build(buildOptions(out));
for (const name of Object.keys(PAGES)) writeFileSync(`${out}/${name}`, pageHtml(name));
