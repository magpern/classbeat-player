// The bundled pages' HTML (build.mjs). Their Content Security Policy is the desktop room screen's,
// imported, never copied, so the two cannot drift (issue #627; a test compares them).
// Each mode has its own pages (issue #630, ModePolicy.kt): rider.html in rider mode; instructor.html
// and the room screen, room.html, in instructor mode. index.html is blank: native code loads a
// mode's page only once it holds the mode, and never shows index.html.
import { ROOM_CSP } from "../../app/src/main/web-preferences.ts";

export const MOBILE_CSP = ROOM_CSP;

/** Each page and the bundle it loads (an entry of build.mjs), or none. */
export const PAGES = {
  "index.html": { title: "Class player", bundle: null },
  "rider.html": { title: "Rider mode", bundle: "rider" },
  "instructor.html": { title: "Instructor mode", bundle: "instructor" },
  "room.html": { title: "Room screen", bundle: "main" },
} as const;

export type PageName = keyof typeof PAGES;

export function pageHtml(name: PageName): string {
  const { title, bundle } = PAGES[name];
  const room = bundle === "main";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${MOBILE_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${title}</title>`,
    ...(bundle ? [`<link rel="stylesheet" href="${bundle}.css">`, `<script src="${bundle}.js" defer></script>`] : []),
    "</head>",
    room ? '<body data-band="hidden" data-join="closed">' : "<body>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
