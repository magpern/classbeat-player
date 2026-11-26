// Builds the pages the app carries into android/app/src/main/assets/public/ and, for the iOS app,
// ios/App/App/public/ (issues #627, #630, #894): the
// room screen (src/main.ts, room.html: the class picked on the class list, issue #871), each
// mode's start page (src/rider.ts, src/instructor.ts), their styles and fonts, and the HTML with the desktop room screen's Content
// Security Policy (src/page.ts). The Capacitor CLI is not used:
// capacitor.config.json and capacitor.plugins.json are committed in the assets folder as they are
// shipped, so no tool rewrites the locked config. Run with tsx (npm run build) to read page.ts.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { buildOptions } from "./build-config.mjs";
import { PAGES, pageHtml } from "./src/page.ts";

for (const out of ["android/app/src/main/assets/public", "ios/App/App/public"]) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build(buildOptions(out));
  for (const name of Object.keys(PAGES)) writeFileSync(`${out}/${name}`, pageHtml(name));
}
