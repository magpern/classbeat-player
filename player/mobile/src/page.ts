// The bundled pages' HTML (build.mjs). Their Content Security Policy is the desktop room screen's,
// imported, never copied, so the two cannot drift (issue #627; a test compares them).
// Each mode has its own pages (issue #630, ModePolicy.kt): rider.html in rider mode; instructor.html
// and the room screen, room.html, in instructor mode. index.html is blank, with no script of ours:
// native code loads it between modes, behind the switching screen, so the last mode's page is gone
// before the next mode's plugin goes on the bridge (PageOpener.kt).
import { ROOM_CSP } from "../../app/src/main/web-preferences.ts";

export const MOBILE_CSP = ROOM_CSP;

/** Each page and the bundle it loads (an entry of build.mjs), or none. */
export const PAGES = {
  "index.html": { title: "Class player", bundle: null },
  "rider.html": { title: "Rider mode", bundle: "rider" },
  "instructor.html": { title: "Instructor mode", bundle: "instructor" },
  "room.html": { title: "Room screen", bundle: "main" },
  // Only the external display's presentation loads the display pages (ExternalDisplayPolicy.kt); no mode shows it.
  "display.html": { title: "Room screen, no class open", bundle: "display" },
  // The same stage with the rider's line, for rider mode (issue #759); chosen by the mode alone.
  "display-rider.html": { title: "Room screen, rider mode", bundle: "display" },
} as const;

/** The one line of each idle stage: a fixed string, never data (plan rule 13). */
export const IDLE_LINES = {
  "display.html": "The class shows here when it opens on the phone",
  "display-rider.html": "Your class is on your phone",
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
    ...(name in IDLE_LINES ? [`<main class="idle"><span data-tier="text" data-lines="2">${IDLE_LINES[name as keyof typeof IDLE_LINES]}</span></main>`] : []),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
