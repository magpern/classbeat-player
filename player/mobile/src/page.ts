// The bundled page's HTML (build.mjs). Its Content Security Policy is the desktop room screen's,
// imported, never copied, so the two cannot drift (issue #627; a test compares them).
import { ROOM_CSP } from "../../app/src/main/web-preferences.ts";

export const MOBILE_CSP = ROOM_CSP;

export function indexHtml(): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${MOBILE_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    "<title>Room screen</title>",
    '<link rel="stylesheet" href="main.css">',
    '<script src="main.js" defer></script>',
    "</head>",
    '<body data-band="hidden" data-join="closed">',
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
