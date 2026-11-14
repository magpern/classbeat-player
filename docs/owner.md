# For the owner

What only the owner can do or decide (AGENTS.md, section 1). Agents add items here and carry on
with other work; nothing in the development loop waits for an answer.

## One-time setup

- **Branch rules on `main`:** require a pull request, the required checks **`ci`** and
  **`pr-title`** (nothing else), squash merges only, no direct pushes, zero required approvals,
  no "branch must be up to date". Agents never change repository settings.
- **Milestones:** the agents' tools cannot create GitHub milestones, so phases are labels
  (`PL0`, …). Create milestones PL0 to PL11 if you want them; agents will use them.
- **A mail service** (before the first deploy): sign-in links and security notices are sent by
  mail (ADR 0002). Which service, and the sending domain.
- **Signing accounts** (before PL7): an Apple Developer membership and a Windows signing identity.
  On a company-managed Mac that blocks apps from unknown sources, a signed and notarised build is
  enough only if the policy allows apps from identified developers; if it allows only the App
  Store, the company's IT has to make an exception for the app in its device management. Until then the unsigned CI build
  (`classbeat-player-macos-unsigned`) runs only on a Mac that is not managed.

## Decisions waiting

- **Defaults agents picked that you may want to change** (ADR 0002, once merged, lists them all):
  sign-up by allowlist only; sign-in links work only in the browser that asked for them; no
  local lock on a studio computer shared by several instructors; account deletion removes
  everything, including removal markers and audit events; 8-letter join codes.
- **Decided (owner, 2026-11-13): network calls in web code are allowed.** The owner reversed the
  web lane's network guard ("allow code to communicate"). #253 removed the network and URL checks
  from `web/test/unit/design.test.ts`; it keeps the import check and the font check, and #255 added
  a check that no web CSS or HTML loads a remote font. The website (#144) was then built in #256,
  and the companion page (#174) is being built.
- **The companion's buttons.** Plan section 3 names start, pause, skip and nudge for the
  handlebar companion. ADR 0005 (section 10) adds resume, so a pause from the phone can be ended
  from the phone, and the one-touch undo of a resync that plan section 4 already puts on the
  companion. Agents built it so; plan section 3 is yours to update or to overrule.
- **Decided (owner, 2026-11-13): the player's network guard and the live connection (#173).**
  Option 1: `WebSocket` is allowed in `player/app/src/main/live/live-socket.ts` only, pinned by a
  test in `rules.test.ts` that the owner committed (b4a6657); every other file keeps the full
  check. Built in #200.
- **Resolved (owner, 2026-11-13): the rail texts (#208).** Pushed at the owner's request and
  merged in #251.
- **One screen (owner, 2026-11-13): questions the room-screen spec leaves open.** Agents picked the
  safe default for each; say if you want another.
  - Taking control by code: a control code on the only screen would be seen by every rider, so
    with one display a phone takes control by sign-in only (ADR 0005).
  - End class sends nothing to the music app (the music keeps playing).
  - The undo of a resync is only Ctrl/Cmd+Z when there is no presenter; there is no on-screen notice.
  - Dropping a phone or switching the phone remote off: only End class does it with one display.
  - The phone remote never starts by itself; the room screen has a "Phone remote" button.
  - The controls stay shown before the start and on Class Complete with one display.
  - "Pairing code for app" is read as the riders' join code, shown with a QR that opens the phone
    remote's sign-in page.
- **Riders with one display (Designer, #358).** With one display the room screen has no riders
  control: Remove, Lock joining and New code are in the presenter window only. Say if you want
  them on the room screen.
- The decisions in [plan.md](plan.md), section 13. Decided so far: the backend stack (Python,
  FastAPI, PostgreSQL); no phone app of our own, with Bluefy on iPhone for sensors; no external
  hardware such as lighting.

## Tasks only the owner can run

- **Spike 1 (music):** run the follower tool, once it exists, on a Mac and a Windows machine with
  a real Spotify account, and hand back the log file.
- **Music link live checks (PL5 is done on fakes).** With a real Spotify account, on macOS,
  Windows and Linux, run a class while following the music and check:
  - interval timing within 1 s for at least 95% of the class, and never more than 2 s off for
    more than 5 s;
  - crossfade off, 5 s and 9 s: the song change is seen within 1 s and the clock never runs
    backwards;
  - pause, seek, next and previous done in Spotify are followed;
  - the player's transport buttons really reach Spotify;
  - a recording that appears twice in the class (ambiguous) is handled;
  - a song that is not in the class shows "Off the list";
  - quitting and restarting Spotify during a class;
  - Windows timestamps; the 30 s repair path; an hour with no drift;
  - the beat flash is within 50 ms of the beat for at least 90% of beats;
  - the helper process stops when the app quits;
  - Linux without MPRIS shows "following the music is unavailable".
- **Music readers, facts agents could not check:**
  - Windows: Spotify's ids (`Spotify.exe`, `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`) were
    taken from memory; PowerShell with `-InputFormat None` and its 15 s start-up.
  - Linux: `busctl` exists only on systemd systems; a real capture of Spotify's MPRIS
    properties is needed, including whether `Position` moves.
  - macOS: how the Automation permission prompt behaves, and the entitlement a packaged build
    needs.
- **Product call:** when Spotify is paused while a browser plays other music, the player shows
  "Off the list". Say if you want something else.
- **Spike 2 (scene):** run the scene builds on a studio-class computer with a second display.
- **Swedebeat:** whether to ask for an agreement and a source of the audio.
