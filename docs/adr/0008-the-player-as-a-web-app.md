# 0008. The player as a web app on a phone or tablet

Status: Proposed

## Context

Plan section 7: "The same screen runs as a web app on a phone or tablet for an instructor without
a computer. It cannot follow Spotify there, because a browser cannot read another app's playback,
so it uses the manual clock, or joins a live session run from a computer." Plan section 12 puts it
in PL8, with nothing needed from the owner.

What exists on `main`:

- The plain 2D room screen is drawn by `web/src/room/` (screens lane). The desktop app bundles it
  through a relative import (`player/app/src/renderer/room.ts`). `mount.ts`, `dom.ts` and the four
  `render-*.ts` files touch the DOM; the rest is pure. `web/src/room/input.ts` mirrors the player's
  snapshot shape, and states that the web lane never imports from `player/`.
- The class clock, including the manual clock (ADR 0001, option D), is pure code in
  `player/app/src/core/clock/` (player lane). `clock.ts`, `plan.ts` and `view.ts` import only each
  other and, as a type, the generated class format. `apply.ts` and `../commands.ts` reach further
  into the player core (link transport, class files).
- The website (`web/src/site/`, built to `dist/site/`) signs a person in with the
  `__Host-cbp_session` cookie (ADR 0002 section 5). It already reads a class with
  `GET /api/site/classes/{id}`. It has a return-entry table for sign-in, with one entry today,
  `control` (`docs/design/site.md`). ADR 0006 lets a sign-in link carry that entry:
  `backend/src/player_backend/login_policy.py` accepts `return_to` only as `control(.CODE)?`.
- The room screen's controls band (`docs/design/room-2d.md`) has Start / Pause / Resume,
  Previous, Next and End. Back 5 s and Forward 5 s stay on the keyboard. Undo is the music link's
  undo of a correction, so on the manual clock it does nothing (`core/clock/apply.ts`).
- A live session is hosted only by a paired app with a device token (ADR 0005 sections 1 and 2;
  ADR 0002 section 8).
- The `web` CI job runs in full only for the paths of the `web` flag in `scripts/detect-changes.sh`.
  For other `player/` changes it runs only the drift test.

## Decision

### 1. What it is

A page of the website, `/play`, built as its own bundle into `dist/site/play/` and served wherever
and however `dist/site/` is served, with the site's page headers (ADR 0002 section 5). It shows one
class from the signed-in person's library on the plain 2D room screen and runs it on the manual
clock. That is all it does in this version:

- **No music link and no audio.** Nothing reads another app's playback, and the page has no media
  element or media API (rule 3). The instructor starts the music in its own app and presses Start
  with it, as with the manual clock on the computer.
- **No live session.** The page hosts nothing, holds no device or host token and shows no control
  code or join code. Plan section 7's "or joins a live session run from a computer" is met by the
  pages that already exist, not by this one: a phone that follows a class run from a computer uses
  the rider page (`/j`, ADR 0007), and a phone that steers it uses the companion (`/control`,
  ADR 0005). Hosting a session from a browser would need a new token type and its own ADR.
- **No sensors and no equipment.** No Web Bluetooth here (that is PL9), and no command to any
  device (rule 2).

### 2. Getting the class

- The page needs a site session. It reads `GET /api/site/classes` (with the list's own `before`
  and `limit` query) and `GET /api/site/classes/{id}`. These are the same routes, cookie,
  same-origin rules and rate limits as the website, so there is no new route and no new place that
  accepts the cookie. ADR 0002 section 5's guard list does not change.
- The class id is carried in the fragment, `/play#<class id>`, so no server sees it in a request
  line. The id names a class and grants nothing, because the API still checks the account. An id
  that is not a UUID in its canonical lowercase form, as `GET /api/site/classes` gives it, is
  ignored, and the page shows the class picker.
- **Kept in memory only.** The class document lives in the page's memory while the page is open.
  Nothing is written to `localStorage`, `sessionStorage`, IndexedDB, the Cache API or a service
  worker. The API answers are already `no-store`.
- **No request during a class.** Everything the class needs, fonts and other assets included, is
  loaded before Start is offered. From Start until the class ends or the person leaves it, the page
  sends no request of any kind. A lost connection during a class changes nothing on the screen.

### 3. Signing in to come back to `/play` (amends ADR 0006)

- The site's return-entry table gains `play`, which returns to `/play`, and `play.<class id>`,
  which returns to `/play#<class id>`, with the class id in the form of section 2. The rules are
  the same as for `control`: the fragment only, read once, kept in memory, removed from the address
  bar before any request, and a full page load to return.
- **ADR 0006 decision 1 is amended.** `return_to` is accepted only if it matches exactly
  `^(control(\.[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4})?|play(\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)$`.
  There is no case folding and no trimming. Anything else answers `422 invalid_return`, in the
  same order as today.
- **Decisions 2 to 6 stand unchanged for `play`.** The value is never stored or logged. The mail
  link carries it after `&return=`. The page reads it through `returnEntryOf`. The site sends
  `return_to` only for an entry that came from a sign-in fragment, as the entry name and id, never
  as a path.
- A class id in a sign-in link reaches only the mailbox of the address that asked. It names a
  class of that account and grants nothing without the sign-in.
- This is a backend change (login policy) and a screens change (the table). As in ADR 0006, they
  may merge in either order: until both have merged, `play` is simply never sent, or never put in
  a link.

### 4. The clock: a shared surface between two lanes

- `web/src/play/` may import exactly three files from `player/`:
  `player/app/src/core/clock/clock.ts`, `plan.ts` and `view.ts`. These form the **shared clock
  surface**. `web/src/room/` still never imports from `player/`, and the rest of `web/` doesn't
  either.
- **Guard (web):** a test reads the syntax tree of every module the play bundle takes from
  `player/`, the way `web/test/lib/core-purity.ts` does, and fails if:
  - any file outside the shared clock surface is reached;
  - a file of the surface imports anything other than each other and the generated class-format
    types;
  - a file of the surface names a DOM or I/O global.
- **Infra:** the `web` flag in `scripts/detect-changes.sh` gains these three exact paths, so a
  change to any of them runs the whole `web` job.
- **Changing the surface.** The shared clock surface belongs to the player lane. A change to its
  exported functions or types is made in its own pull request, as with the contract (AGENTS.md
  section 3, rule 1). That pull request may also update the call sites in `web/src/play/` and
  nothing else in `web/`, and `main` stays green. A change inside the files that keeps their
  exports needs nothing in `web/`, and the full `web` job proves it.

### 5. The screen and its controls

- The controls are the controls band's: **Start / Pause / Resume**, **Previous**, **Next** and
  **End**. End asks before it ends, as on the room screen. They are touch targets.
- The band's keys are kept for a tablet with a keyboard or a presentation clicker. Space works,
  Previous and Next work, and so do Back 5 s and Forward 5 s.
- There is no Undo, Follow the music or Manual clock control, because the page has only the manual
  clock.
- **Keep-awake:** the Screen Wake Lock API while a class runs. It is released when the class ends
  or the page is hidden, and asked for again when the page is shown. If the browser refuses, one
  line says so, and the class still runs.
- **Full screen:** the Fullscreen API where the browser allows it. Where it does not (an iPhone),
  the page fills the viewport and says nothing about it.
- **Sizes:** phone portrait and landscape, and tablet portrait and landscape. The Designer's spec
  (`docs/design/play.md`) sets the layout at each size from the room screen's. The room screen code
  gains what it needs for small and portrait sizes, in the screens lane.

### 6. Headers, requests and banned APIs

- The page is served with the site's CSP and `Referrer-Policy: no-referrer`. It loads its own
  script, stylesheet and fonts from its own origin, with no inline script and nothing from another
  origin.
- **Guard:** the play page's fake test, like the site's, lists every request the page makes in each
  state, assets included, and compares them with this ADR:
  - the page's own files;
  - `GET /api/site/classes` (with `before` and `limit`);
  - `GET /api/site/classes/{id}`;
  - the site's sign-in and sign-out requests.

  While a class runs, the list is empty.
- **Guard:** a syntax-tree test fails if the play bundle's own code names any of:
  - `HTMLMediaElement`, `HTMLAudioElement`, `HTMLVideoElement`, `Audio`, `AudioContext`,
    `webkitAudioContext`, `MediaSource`, `MediaStream` or `MediaRecorder`;
  - `navigator.mediaSession`, `navigator.mediaDevices` or `navigator.bluetooth`;
  - `WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB`, `caches` or
    `navigator.serviceWorker`;
  - an `audio` or `video` element created by name.

### 7. Product rules touched

- **Rule 1:** the class is shown as sent. The manual clock moves through it and changes nothing.
- **Rule 2:** no device commands.
- **Rule 3:** no audio, and no music read.
- **Rules 4 and 6:** the room screen is laid out again for phone and portrait sizes. It stays the
  plain score, with no road, track or world, and none of MOWL's look (no ring trio and none of its
  palette).
- **Rule 7:** colour means the planned zone, and the zone number and name stay.
- **Rules 8 to 10:** carried unchanged by the room screen.

There is no live session, so rules 13 to 15 do not apply. Each issue names the rules it touches,
and its review lists them.

### 8. Security-critical and rule-sensitive parts

- **The login policy change (section 3)** is security-critical: an Opus Developer and an Opus
  Reviewer.
- **The site's return entries (section 3)** change sign-in, so the screens pull request that adds
  them gets a top-tier Reviewer.
- **The play page** is rule-sensitive (rules 1 to 4, 6 and 7), so it gets a top-tier Reviewer.
- **The infra change** is not security-critical.

### 9. Issue outline

1. **docs (Designer):** `docs/design/play.md`. It covers the class picker and the screen with its
   controls at phone and tablet sizes, and these states:
   - signed out;
   - loading;
   - offline at open;
   - a class not found;
   - wake lock refused;
   - End asked;
   - the end of the class;
   - a reload during a class.

   Each comes with reference mock-ups.
2. **infra:** the `web` flag gains the three files of the shared clock surface, with cases in
   `scripts/test-detect-changes.sh`.
3. **backend (security-critical):** the amended `return_to` pattern of section 3, with its tests.
   These include a `play` entry with an id in upper case, a short id, an id with a trailing
   character, and `play.` with nothing after it, each answering `422`.
4. **screens:** the play bundle (`web/src/play/`, built to `dist/site/play/`). It holds:
   - the class picker;
   - the room screen on the manual clock;
   - the controls and keys;
   - keep-awake and full screen;
   - the guards of sections 4 and 6, on a fake of the site API.

   Depends on 1 and 2.
5. **screens:** the return entries `play` and `play.<class id>`, and a "Play on this device" link
   from the website's class details. Depends on 4. Item 3 may merge before or after it.

## Alternatives

- **The desktop app's renderer as a web page.** It is built around the `window.room` and
  `window.player` bridges, pairing and the music link. Stripping them out would be a second app in
  disguise.
- **A device token in the browser** (pairing a phone as a player). It would put a long-lived token
  in a browser, need a new storage decision, and keep the class library offline. The site session
  already reads classes. A paired browser player can come later with its own ADR if offline use is
  asked for.
- **Moving the clock to a shared package.** It is cleaner in the long run, but it needs a new lane,
  a workspace and a change to the desktop build. The three-file shared surface with a guard and a
  CI path is reversible, and it matches how the desktop app already takes the room screen.
- **No return entry for `play`** (sign-in always lands on `/classes`). It avoids touching the login
  policy, but an instructor who opened a class on a phone would lose it at sign-in.
- **An offline cache in the browser.** It would keep class documents on a shared or lost phone. It
  is left out until someone asks for it.

## Consequences

- An instructor with only a phone or tablet can run a class on the manual clock from their own
  library, signed in on the site.
- In the browser only the manual clock is available. Following Spotify stays a desktop feature
  (ADR 0001).
- A reload, or a tab the browser discards during a class, loses the class and its place. Opening
  it again needs the network, and the class starts from the beginning. The design spec says what
  the person sees.
- The web lane depends on three files of the player lane's clock, kept honest by a guard, a CI path
  and the shared-surface rule of section 4.
- The room screen code must also work at phone sizes and in portrait.
- No new token, and no new place that accepts the session cookie. The login policy accepts one
  more return entry.
