// The desktop app's esbuild builds, one entry per shipped file (build.mjs runs them; the Bluetooth guard
// test, issue #686, builds the same list in memory, so a new build is scanned at once).
const common = { bundle: true, sourcemap: false, logLevel: "warning", legalComments: "none" };
const node = { platform: "node", format: "cjs", target: "node22", external: ["electron"] };
const page = { platform: "browser", format: "iife", target: "chrome130" };

export const BUILDS = [
  { ...common, ...node, entryPoints: ["src/main/main.ts"], outfile: "dist/main.cjs" },
  { ...common, ...node, entryPoints: ["src/preload/preload.ts"], outfile: "dist/preload.cjs" },
  { ...common, ...node, entryPoints: ["src/preload/room-preload.ts"], outfile: "dist/room-preload.cjs" },
  { ...common, ...page, entryPoints: ["src/renderer/presenter.ts"], outfile: "dist/presenter.js" },
  // The class list: its script, its style (with the design tokens) and the fonts the style names.
  { ...common, ...page, entryPoints: ["src/renderer/classlist.ts"], outdir: "dist", loader: { ".woff2": "file" }, assetNames: "fonts/[name]" },
  // The room screen: web/src/main.ts with its tokens, style and fonts, under their own folder so the
  // two pages' font files never race for one name.
  { ...common, ...page, entryPoints: ["src/renderer/room.ts"], outdir: "dist", loader: { ".woff2": "file" }, assetNames: "room-fonts/[name]" },
];
