# 0008. The player as a web app on a phone or tablet

Status: Proposed

## Context

Plan section 7: "The same screen runs as a web app on a phone or tablet for an instructor without
a computer. It cannot follow Spotify there, because a browser cannot read another app's playback,
so it uses the manual clock, or joins a live session run from a computer." Plan section 12 puts it
in PL8, with nothing needed from the owner.

What exists on `main`:

- The plain 2D room screen is drawn by `web/src/room/` (screens lane). The desktop app bundles it
  through a relative import (`player/app/src/renderer/room.ts`). Only `mount.ts` and `dom.ts` touch
  the DOM.
- The class clock, including the manual clock (ADR 0001, option D), is pure code in
  `player/app/src/core/clock/` (player lane). It imports no Electron, Node or DOM.
- The website (`web/src/site/`, built to `dist/site/`) signs a person in with the
  `__Host-cbp_session` cookie (ADR 0002 section 5). It already reads a class document with
  `GET /api/site/classes/{id}`. It has a return-entry table for sign-in (today one entry,
  `control`; `docs/design/site.md`).
- A live session is hosted only by a paired app with a device token (ADR 0005 sections 1 and 2;
  ADR 0002 section 8). The rider page (`/j`, ADR 0007) and the companion (`/control`, ADR 0005)
  are the phone's ways into a session someone else runs.

## Decision

### 1. What it is

A page of the website, `/play`, built as its own bundle into `dist/site/play/` and served wherever
and however `dist/site/` is served, with the site's page headers (ADR 0002 section 5). It shows one
class from the signed-in person's library on the plain 2D room screen and runs it on the manual
clock. That is all it does in this version:

- **No music link and no audio.** Nothing reads another app's playback, and the page has no
  `audio` or `video` element and no media API (rule 3). The instructor starts the music in its own
  app and presses Start with it, as with the manual clock on the computer.
- **No live session.** The page hosts nothing, holds no device or host token and offers no
  control code or join code. A phone that wants to follow a class run from a computer uses the
  rider page (`/j`); a phone that wants to steer it uses the companion (`/control`). Hosting a
  session from a browser would need a new token type and a new design; it is not part of this ADR.
- **No sensors and no equipment.** No Web Bluetooth here (that is PL9) and no command to any
  device (rule 2).

### 2. Getting the class

- The page needs a site session. It reads `GET /api/site/classes` for the list and
  `GET /api/site/classes/{id}` for the chosen class, the same routes, cookie, same-origin rules and
  rate limits as the website. No new route, and no new place that accepts the cookie
  (ADR 0002 section 5's guard list does not change).
- Signed out, it sends the person to Sign in with the return entry `play`, or `play.<class id>`
  when the address named a class. These are added to the site's return-entry table under the same
  rules as `control`: the fragment only, read once, kept in memory and removed from the address bar
  before any request. A class id that is not a UUID in its canonical lowercase form (as
  `GET /api/site/classes` gives it) is ignored.
- The class id is carried in the fragment, `/play#<class id>`, so no server sees it in a request
  line. The id names a class and grants nothing: the API still checks the account.
- **Kept in memory only.** The class document lives in the page's memory for as long as the page is
  open. Nothing is written to `localStorage`, `sessionStorage`, IndexedDB, the Cache API or a
  service worker. No offline cache in this version: the page needs the network to open a class.
- **No request during a class.** From Start until the class ends or the person leaves it, the page
  sends no request. A lost connection during a class changes nothing on the screen.

### 3. The clock and the screen

- The page uses the class clock from `player/app/src/core/clock/` through a relative import, the
  same way the desktop app imports `web/src/room/`. The clock stays in the player lane, and the
  web lane never edits it.
- **Guard:** a web test lists every file the play bundle takes from `player/` and checks each one
  imports nothing outside `player/app/src/core/` and `schema/generated/ts/` (types only). Taking any
  other file from `player/` fails it.
- **Infra:** the `web` CI job also runs for a change under `player/app/src/core/clock/`, so a
  change to the clock is tested in both places.
- The controls are the manual clock's: Start, Pause and Resume, Previous, Next, back and forward
  5 seconds, and Undo, as in the room screen's controls band (`docs/design/room-2d.md`). They are
  touch targets. The page also reacts to the same keys as the band, for a tablet with a keyboard or
  a presentation clicker.
- **Keep-awake:** the Screen Wake Lock API while a class runs, released when it ends or the page is
  hidden, and requested again when the page is shown. If the browser refuses, a line says so; the
  class still runs.
- **Full screen:** the Fullscreen API where the browser allows it. Where it does not (an iPhone),
  the page fills the viewport and says nothing about it.
- **Sizes:** phone portrait and landscape, and tablet portrait and landscape. The Designer's spec
  (`docs/design/play.md`) sets the layout at each size from the room screen's, and the room screen
  code gains what it needs for small and portrait sizes in the screens lane.

### 4. Headers and requests

- The page is served with the site's CSP and `Referrer-Policy: no-referrer`. It loads one script
  and one stylesheet from its own origin, with no inline script and nothing from another origin.
- **Guard:** the play page's fake test, like the site's, lists every request the page makes in each
  state and compares them with this ADR: `GET /api/site/classes`, `GET /api/site/classes/{id}`, and
  the site's sign-out. During a running class the list is empty.
- **Guard:** a test fails if the play bundle contains a media element, a media API, Web Bluetooth,
  `WebSocket`, a storage API or a service worker registration.

### 5. Product rules touched

Rule 1 (the class is shown as sent; the manual clock moves through it and changes nothing), rule 2
(no device commands), rule 3 (no audio, no music read), and rule 7 (colour means the planned zone;
the room screen's zone number and name stay). No live session, so rules 13 to 15 do not apply. The
screens issue and its review list them.

### 6. Security-critical and rule-sensitive parts

- The return entries `play` and `play.<class id>` change sign-in, so the screens pull request that
  adds them gets a top-tier Reviewer.
- The play page as a whole is rule-sensitive (rules 1, 2, 3 and 7), so it gets a top-tier Reviewer.
- The infra change is not security-critical.

### 7. Issue outline

1. **docs (Designer):** `docs/design/play.md`, covering the class picker, the screen and its
   controls at phone and tablet sizes, signed out, loading, offline at open, a class not found,
   wake lock refused, and the end of the class, with reference mock-ups.
2. **infra:** the `web` job also runs for `player/app/src/core/clock/`, with cases in
   `scripts/test-detect-changes.sh`.
3. **screens:** the play bundle (`web/src/play/`, built to `dist/site/play/`): the class picker, the
   room screen on the manual clock, the controls, keep-awake, full screen, and the guards of
   sections 3 and 4, on a fake of the site API. Depends on 1 and 2.
4. **screens:** the return entries `play` and `play.<class id>`, and a "Play on this device" link
   from the website's class details. Depends on 3.

## Alternatives

- **The desktop app's renderer as a web page.** It is built around the `window.room` and
  `window.player` bridges, pairing and the music link. Stripping them out would be a second app in
  disguise.
- **A device token in the browser** (pairing a phone as a player). That would give a browser a
  long-lived token. It would also need a new storage decision, and the class library offline. The
  site session already reads classes. A paired browser player can come later with its own ADR if
  offline use is asked for.
- **Moving the clock to a shared package.** That is cleaner in the long run, but it means a new
  lane, a workspace and a change to the desktop build. The relative import plus a guard is
  reversible and matches how the desktop app already takes the room screen.
- **An offline cache in the browser.** It would keep class documents on a shared or lost phone. It
  is left out until it is asked for.

## Consequences

- An instructor with only a phone or tablet can run a class on the manual clock from their own
  library, signed in on the site.
- Only the manual clock is available in the browser. Following Spotify stays a desktop feature
  (ADR 0001).
- The web lane depends on the player lane's pure clock code, guarded by a test and by CI.
- The room screen code must also work at phone sizes and in portrait.
- No new token, no new route and no new place that accepts the session cookie.
