// Builds dist/: the shell (main.cjs), the preload scripts (preload.cjs, room-preload.cjs), the
// presenter page and its style sheet, the class list page, and the room screen's page (the web
// lane's room screen, bundled in).
// Bundled with the pinned esbuild; the class schema and its validator are bundled in, so the
// application never reads the schema from the repository at run time.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";
import { BUILDS } from "./build-config.mjs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

await Promise.all(BUILDS.map((b) => build(b)));
copyFileSync("src/renderer/presenter.html", "dist/presenter.html");
copyFileSync("src/renderer/classlist.html", "dist/classlist.html");
copyFileSync("src/renderer/room.html", "dist/room.html");
